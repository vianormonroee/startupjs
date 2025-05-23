const nodePath = require('path')
const t = require('@babel/types')
const template = require('@babel/template').default

const PROCESS_PATH = '@startupjs/babel-plugin-rn-stylename-to-style/process'
const STYLE_NAME_REGEX = /(?:^s|S)tyleName$/
const STYLE_REGEX = /(?:^s|S)tyle$/
const ROOT_STYLE_PROP_NAME = 'style'

const { GLOBAL_NAME, LOCAL_NAME } = require('./constants.cjs')

const buildSafeVar = template.expression(`
  typeof %%variable%% !== 'undefined' && %%variable%%
`)

const buildImport = template(`
  import { process as %%name%% } from '${PROCESS_PATH}'
`)

const buildRequire = template(`
  const %%name%% = require('${PROCESS_PATH}').process
`)

module.exports = function (babel) {
  let styleHash = {}
  let specifier

  function getStyleFromExpression (expression, state) {
    state.hasTransformedClassName = true
    const cssStyles = specifier.local.name
    const processCall = t.callExpression(
      state.reqName,
      [expression, t.identifier(cssStyles)]
    )
    return processCall
  }

  function addPartStyleToProps (partAttrPath) {
    const partNames = partAttrPath.node.value.value.split(' ').filter(Boolean)
    let closestFnPath = partAttrPath
    // find react functional component declaration.
    // While searching, skip named functions which start from lowercase
    while (true) {
      closestFnPath = closestFnPath.getFunctionParent()
      if (!closestFnPath) break // if we reached Program
      if (!(
        (
          t.isFunctionDeclaration(closestFnPath.node) ||
          t.isFunctionExpression(closestFnPath.node)
        ) && (
          closestFnPath.node.id &&
          closestFnPath.node.id.name &&
          /^[a-z]/.test(closestFnPath.node.id.name)
        )
      )) {
        break
      }
    }
    if (!closestFnPath) {
      throw partAttrPath.buildCodeFrameError(`
        Closest react functional component not found for 'part' attribute.
        Or your component is named lowercase.'
      `)
    }
    let props = closestFnPath.node.params[0]
    if (!props) {
      props = partAttrPath.scope.generateUidIdentifier('props')
      closestFnPath.node.params[0] = props
    }
    if (t.isAssignmentPattern(props)) {
      props = props.left
    }
    const styleProps = []
    if (t.isIdentifier(props)) {
      for (const partName of partNames) {
        const partStyleAttr = convertPartName(partName)
        styleProps.push(
          t.memberExpression(props, t.identifier(partStyleAttr))
        )
      }
    } else if (t.isObjectPattern(props)) {
      // TODO: optimize to be more efficient than O(n^2)
      for (const partName of partNames) {
        const partStyleAttr = convertPartName(partName)
        let exists
        // Check whether the part style property already exists
        for (const property of props.properties) {
          if (!t.isObjectProperty(property)) continue
          if (property.key.name === partStyleAttr) {
            styleProps.push(property.value)
            exists = true
            break
          }
        }
        if (exists) continue
        // If part style property doesn't exist, inject it
        const key = t.identifier(partStyleAttr)
        const value = partAttrPath.scope.generateUidIdentifier(partStyleAttr)
        props.properties.push(t.objectProperty(key, value))
        styleProps.push(value)
      }
    } else {
      throw partAttrPath.buildCodeFrameError(`
        Can't find props attribute and embed part style props into it.
        Supported props formats:
          - function Hello ({ one, two }) {}
          - function Hello (props) {}
      `)
    }
    return styleProps
  }

  function handleStyleNames (jsxOpeningElementPath, state) {
    if (!styleHash[ROOT_STYLE_PROP_NAME]) return
    const styleName = styleHash[ROOT_STYLE_PROP_NAME].styleName
    const partStyle = styleHash[ROOT_STYLE_PROP_NAME].partStyle
    const inlineStyles = []

    // Don't process this element if neither styleName or part found.
    if (!styleName && !partStyle) return

    // Check if styleName exists and if it can be processed
    if (styleName != null) {
      if (!(
        t.isStringLiteral(styleName.node.value) ||
        t.isJSXExpressionContainer(styleName.node.value)
      )) {
        throw jsxOpeningElementPath.buildCodeFrameError(`
          styleName attribute has an unsupported type. It must be either a string or an expression.

          Most likely you wrote styleName=[] instead of styleName={[]}
        `)
      }
    }

    // Gather all inline styles
    for (const key in styleHash) {
      if (styleHash[key].style || styleHash[key].partStyle) {
        let style = []
        if (styleHash[key].style) {
          style.push(styleHash[key].style.node.value.expression)
        }
        // Part style has higher priority, so must be last
        if (styleHash[key].partStyle) {
          style = style.concat(styleHash[key].partStyle)
        }
        if (style.length > 1) {
          style = t.arrayExpression(style)
        } else {
          style = style[0]
        }
        inlineStyles.push(t.objectProperty(
          t.identifier(key),
          style
        ))
      }
    }

    // Create a `process` function call
    state.hasTransformedClassName = true
    const processCall = t.callExpression(
      state.reqName,
      [
        styleName ? (
          t.isStringLiteral(styleName.node.value)
            ? styleName.node.value
            : styleName.node.value.expression
        ) : t.stringLiteral(''),
        specifier
          ? t.identifier(specifier.local.name)
          : t.objectExpression([]),
        buildSafeVar({ variable: t.identifier(GLOBAL_NAME) }),
        buildSafeVar({ variable: t.identifier(LOCAL_NAME) }),
        t.objectExpression(inlineStyles)
      ]
    )

    jsxOpeningElementPath.node.attributes.push(
      t.jsxSpreadAttribute(processCall)
    )

    // Remove old attributes
    for (const key in styleHash) {
      if (styleHash[key].style) styleHash[key].style.remove()
      if (styleHash[key].styleName) styleHash[key].styleName.remove()
    }

    // Clear hash since we handled everything
    for (const key in styleHash) {
      delete styleHash[key].styleName
      delete styleHash[key].style
      delete styleHash[key].partStyle
      delete styleHash[key]
    }
    styleHash = {}
  }

  function handleStyleName (state, convertedName, styleName, style) {
    let expressions

    if (
      styleName == null ||
      specifier == null ||
      !(
        t.isStringLiteral(styleName.node.value) ||
        t.isJSXExpressionContainer(styleName.node.value)
      )
    ) {
      return
    }

    if (t.isStringLiteral(styleName.node.value)) {
      expressions = [
        getStyleFromExpression(styleName.node.value, state)
      ]
    } else if (t.isJSXExpressionContainer(styleName.node.value)) {
      expressions = [
        getStyleFromExpression(styleName.node.value.expression, state)
      ]
    }

    const hasStyleNameAndStyle =
      styleName &&
      style &&
      styleName.parentPath.node === style.parentPath.node

    if (hasStyleNameAndStyle) {
      style.node.value = t.jsxExpressionContainer(
        t.arrayExpression(
          expressions.concat([style.node.value.expression])
        )
      )
      styleName.remove()
    } else {
      if (expressions.length > 1) {
        styleName.node.value = t.jsxExpressionContainer(t.arrayExpression(expressions))
      } else {
        styleName.node.value = t.jsxExpressionContainer(expressions[0])
      }
      styleName.node.name.name = convertedName
    }
  }

  return {
    post () {
      styleHash = {}
      specifier = undefined
    },
    visitor: {
      Program: {
        enter (path, state) {
          state.reqName = path.scope.generateUidIdentifier(
            'processStyleName'
          )
        },
        exit (path, state) {
          if (!state.hasTransformedClassName) {
            return
          }

          const lastImportOrRequire = path
            .get('body')
            .filter(p => p.isImportDeclaration() || isRequire(p.node))
            .pop()

          if (lastImportOrRequire) {
            lastImportOrRequire.insertAfter(
              state.opts.useImport
                ? buildImport({ name: state.reqName })
                : buildRequire({ name: state.reqName })
            )
          }
        }
      },
      ImportDeclaration: function importResolver (path, state) {
        const extensions =
          Array.isArray(state.opts.extensions) &&
          state.opts.extensions

        if (!extensions) {
          throw new Error(
            'You have not specified any extensions in the plugin options.'
          )
        }

        const node = path.node

        if (extensions.indexOf(getExt(node)) === -1) {
          return
        }

        const anonymousImports = path.container.filter(n => {
          return (
            t.isImportDeclaration(n) &&
            n.specifiers.length === 0 &&
            extensions.indexOf(getExt(n)) > -1
          )
        })

        if (anonymousImports.length > 1) {
          throw new Error(
            'Cannot use anonymous style name with more than one stylesheet import.'
          )
        }

        specifier = node.specifiers[0]

        if (!specifier) {
          specifier = t.ImportDefaultSpecifier(
            path.scope.generateUidIdentifier('css')
          )
          node.specifiers = [specifier]
        }
      },
      JSXOpeningElement: {
        exit (path, state) {
          // TODO: Don't handle *StyleName separately, instead merge it into handleStyleNames()
          for (const key in styleHash) {
            // root styleName can only be handled by new logic in handleStyleNames()
            if (key === ROOT_STYLE_PROP_NAME) continue
            if (styleHash[key].styleName) {
              handleStyleName(state, key, styleHash[key].styleName, styleHash[key].style)
              delete styleHash[key].styleName
              delete styleHash[key].style
              delete styleHash[key]
            }
          }
          // New logic with support for ::part(name) pseudo-class
          handleStyleNames(path, state)
          styleHash = {}
        }
      },
      JSXAttribute: function JSXAttribute (path, state) {
        const name = path.node.name.name
        if (STYLE_NAME_REGEX.test(name)) {
          const convertedName = convertStyleName(name)
          if (!styleHash[convertedName]) styleHash[convertedName] = {}
          styleHash[convertedName].styleName = path
        } else if (STYLE_REGEX.test(name)) {
          if (!styleHash[name]) styleHash[name] = {}
          styleHash[name].style = path
        } else if (name === 'part') {
          if (!t.isStringLiteral(path.node.value)) {
            throw path.buildCodeFrameError('\'part\' attribute supports only static string values')
          }
          const styleProps = addPartStyleToProps(path)
          if (!styleHash[ROOT_STYLE_PROP_NAME]) styleHash[ROOT_STYLE_PROP_NAME] = {}
          styleHash[ROOT_STYLE_PROP_NAME].partStyle = styleProps
          path.remove()
        }
      }
    }
  }
}

function isRequire (node) {
  return node?.declarations?.[0]?.init?.callee?.name === 'require'
}

function getExt (node) {
  return nodePath.extname(node.source.value).replace(/^\./, '')
}

function convertStyleName (name) {
  return name.replace(/Name$/, '')
}

function convertPartName (partName) {
  if (partName === 'root') return 'style'
  return partName + 'Style'
}
