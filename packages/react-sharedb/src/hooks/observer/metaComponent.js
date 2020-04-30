import { ComponentMetaContext } from '../meta'
import DEFAULT_OPTIONS from './defaultOptions'

function wrapMetaComponent (
  Component,
  options = {}
) {
  const { forwardRef, suspenseProps } = { ...DEFAULT_OPTIONS, ...options }
  if (!(suspenseProps && suspenseProps.fallback)) {
    throw Error('[observer()] You must pass at least a fallback parameter to suspenseProps')
  }

  function ObserverWrapper (props, ref) {
    var componentMeta = React.useMemo(function () {
      const componentId = $root.id()
      return {
        componentId,
        createdAt: Date.now(),
        // $self: $root.at(`$components.${componentId}`)
      }
    }, [])
    return React.createElement(
      ComponentMetaContext.Provider,
      { value: componentMeta },
      React.createElement(
        React.Suspense,
        suspenseProps,
        forwardRef
          ? React.createElement(Component, { ...props, ref })
          : React.createElement(Component, props)
      )
    )
  }

  let memoComponent
  pipeComponentMeta(Component, ObserverWrapper, 'Observer', 'StartupjsWrapperObserver')

  if (forwardRef) {
    memoComponent = React.memo(React.forwardRef(ObserverWrapper))
  } else {
    memoComponent = React.memo(ObserverWrapper)
  }

  pipeComponentMeta(Component, memoComponent)
  return memoComponent
}
