let dotty = require('dotty')
let ZSchema = require('z-schema')

class Schema {
  constructor (backend, options) {
    this.backend = backend

    let _options = (this.options = options || {})

    this.ZSchema = ZSchema

    if (_options.formats) {
      for (let format in _options.formats) {
        ZSchema.registerFormat(format, _options.formats[format])
      }
    }
    this.customValidators = _options.validators || {}

    this.validator = new ZSchema()

    if (!_options.schemas) throw new Error('Schemas are required in options')
    // Compile and validate schemas
    this.validator.compileSchema(_options.schemas)
    this.schemas = _options.schemas
  }

  commitHandler = (shareRequest, done) => {
    const opData = shareRequest.op

    if (opData.del) {
      done()
      return
    }

    const collection = shareRequest.index || shareRequest.collection
    const docId = shareRequest.id

    let rootSchema = this.schemas[collection]

    const formatError = (err) => {
      if (!err) {
        return
      }

      // console.info(err);

      err.code = 'ERR_VALIDATION_FAILED'
      err.message = JSON.stringify({ collection, docId, errors: err.errors }, null, 2)

      return err
    }

    if (!rootSchema) {
      if (this.options.skipNonExisting) return done()

      return done(formatError(new Error('No schema for collection: ' + collection)))
    }

    const newDoc = shareRequest.snapshot.data

    // Root paths as we want to validate whole doc
    let paths = []

    // Custom validator contexts
    try {
      var contexts = this.getContexts(rootSchema, newDoc, paths)
    } catch (err) {
      return done(formatError(this._getError(err)))
    }

    let validateCreate = (err) => {
      // If there was no error from async custom validators,
      //   run sync schema validation and sync custom validators

      done(formatError(err || this.validate(newDoc, rootSchema, paths, contexts)))
    }

    let counter = this._getCounter()

    this.runAsyncs(contexts, counter, validateCreate)

    // There was no countexts or not async fn in any of them
    if (counter.count === 0 && !counter.sent) {
      validateCreate()
    }
  };

  runAsyncs = (contexts, counter, done) => {
    let self = this
    let error = this._getError()

    const formatError = (err) => {
      if (!err) {
        return
      }

      err.code = 'ERR_VALIDATION_FAILED'
      err.message = JSON.stringify({ errors: err.errors }, null, 2)

      return err
    }

    for (let k = 0; k < contexts.length; k++) {
      let context = contexts[k]
      let customValidator = context.customValidator

      if (customValidator.async) {
        counter.count++

        setTimeout(function () {
          (function () {
            customValidator.async.call(self, context, function (err, data) {
              if (err) {
                err.paths = context.paths
                error.errors.push(err)
              }

              context.data = data

              counter.count--
              if (counter.count === 0 && !counter.sent) {
                counter.sent = true

                if (error.errors.length) {
                  done(formatError(error))
                } else {
                  done()
                }
              }
            })
          })(context)
        }, 0)
      }
    }
  };

  validate = (doc, rootSchema, paths, contexts) => {
    let error = this._getError()

    // Schema validation is here
    //   everytime we validate the whole doc, because it`s only case
    //   when z-schema returns full paths with errors
    let valid = this.validator.validate(doc, rootSchema)

    // console.log({ valid, doc });

    if (!valid) {
      error.errors = this.validator.getLastErrors()

      // Parse path to array for each error
      for (let i = 0; i < error.errors.length; i++) {
        let parsedError = error.errors[i]

        let path = parsedError.path
        let _paths = []

        // Avoiding '#/'
        if (path.length > 2) {
          _paths = path.split('/').slice(1)
        }

        // Add last part from params.property
        if (parsedError.params && parsedError.params.property) {
          _paths.push(parsedError.params.property)
        }

        for (let k = 0; k < paths.length; k++) {
          let part = paths[k]

          if (part[0] === '[') {
            _paths[k] = +part.slice(1, part.length - 1)
          }
        }

        error.errors[i].paths = paths
      }
    }

    // Custom validators
    if (contexts) {
      for (let i = 0; i < contexts.length; i++) {
        let context = contexts[i]

        if (!context.customValidator.sync) continue

        let value

        if (context.paths.length) {
          value = dotty.get(doc, context.paths)
        } else {
          value = doc
        }

        if (!value) continue

        let err = context.customValidator.sync(value, context)

        if (err) {
          err.paths = context.paths
          error.errors.push(err)
        }
      }
    }

    if (error.errors.length > 0) {
      // console.log(JSON.stringify(error, null, 2));
      return error
    }
  };

  getContexts = (schema, value, defaultPaths, paths) => {
    let results = []

    paths = paths || []

    if (!schema) {
      return results
    }

    if (schema.validators) {
      for (let i = 0; i < schema.validators.length; i++) {
        let validatorName = schema.validators[i]
        let customValidator = this.customValidators[validatorName]
        if (!customValidator) throw Error('Unknown validator: ' + validatorName)
        results.push({
          name: validatorName,
          customValidator: customValidator,
          paths: defaultPaths.concat(paths),
          schema: schema,
          value: value
        })
      }
    }

    if (schema.type === 'object') {
      if (value) {
        for (let key in value) {
          try {
            results = results.concat(
              this.getContexts(
                this._getSchemaForObjectProperty(schema, key, paths),
                value[key],
                defaultPaths,
                paths.concat([key])
              )
            )
          } catch (err) {
            // Prevent overwriting if we catched rethrown error
            if (!err.paths) {
              err.paths = defaultPaths.concat(paths)
            }

            throw err
          }
        }
      }
    } else if (schema.type === 'array') {
      if (value) {
        for (let i = 0; i < value.length; i++) {
          let passValue = value[i]
          results = results.concat(
            this.getContexts(schema.items, passValue, defaultPaths, paths.concat([i]))
          )
        }
      }
    }

    return results
  };

  _getSchemaForPaths = (schema, paths) => {
    if (!paths.length) return schema

    let property = paths[0]

    paths = paths.slice(1)

    if (schema.type === 'object') {
      try {
        return this._getSchemaForPaths(this._getSchemaForObjectProperty(schema, property), paths)
      } catch (err) {
        if (!err.paths) {
          err.paths = paths.concat([property])
        }

        throw err
      }
    } else if (schema.type === 'array') {
      return this._getSchemaForPaths(schema.items, paths)
    } else if (schema.type === 'string') {
      // String operations
      return schema
    }
  };

  _getSchemaForObjectProperty = (schema, property, paths) => {
    if (schema.properties && schema.properties[property]) {
      return schema.properties[property]
    }

    if (schema.patternProperties) {
      for (let patternProperty in schema.patternProperties) {
        let pattern = new RegExp(patternProperty)

        if (pattern.test(property)) {
          return schema.patternProperties[patternProperty]
        }
      }
    }

    if (
      schema.additionalProperties === true ||
      (!schema.additionalProperties && schema.additionalProperties !== false)
    ) {
      return {}
    } else if (schema.additionalProperties) {
      return schema.additionalProperties
    }

    paths.push(property)

    throw Error('Property "' + property + '" is invalid')
  };

  _getCounter = () => {
    return {
      count: 0,
      sent: false
    }
  };

  _getError = (err) => {
    let error = Error('Not valid')

    error.errors = []

    if (err) {
      error.errors.push(err)
    }

    return error
  };
}

module.exports = Schema
