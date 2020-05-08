import React from 'react'
import propTypes from 'prop-types'
import { observer } from 'startupjs'
import Div from './../Div'
import CollapseHeader from './CollapseHeader'
import CollapseContent from './CollapseContent'
import { useBindingProps } from '../../hooks'
import './index.styl'

// TODO: hover, active states
function Collapse ({
  style,
  children,
  title,
  open,
  $open,
  variant,
  onChange
}) {
  ({ open, onChange } = useBindingProps($open, { open }, { onChange }))
  let header
  const contentChildren = []
  React.Children.forEach(children, child => {
    switch (child.type) {
      case CollapseHeader:
        if (header) throw Error('[ui -> Modal] You must specify a single <Collapse.Header>')
        header = child
        break
      default:
        contentChildren.push(child)
    }
  })

  const headerProps = { open, variant, onPress }
  header = header
    ? React.cloneElement(header, { ...headerProps, ...header.props })
    : React.createElement(CollapseHeader, headerProps, title || '')

  const doChildrenHaveCollapseContent =
    !!contentChildren.filter(child => child.type === CollapseContent).length

  const contentProps = { open, variant }
  const content = doChildrenHaveCollapseContent
    ? contentChildren
      .map((child, index) => {
        const props = child.type === CollapseContent ? { ...contentProps } : {}
        props.key = `__COLLAPSE_CONTENT_${index}__`

        return React.cloneElement(
          child,
          props
        )
      })
    : React.createElement(CollapseContent, contentProps, contentChildren)

  function onPress () {
    onChange && onChange(!open)
  }

  const extraProps = {}
  if (variant === 'full') {
    extraProps.level = 1
  }

  return pug`
    Div.root(style=style ...extraProps)
      = header
      = content
  `
}

Collapse.defaultProps = {
  open: false,
  variant: 'full'
}

Collapse.propTypes = {
  style: propTypes.oneOfType([propTypes.object, propTypes.array]),
  children: propTypes.node,
  open: propTypes.bool,
  variant: propTypes.oneOf(['full', 'pure']),
  onChange: propTypes.func
}

const ObserverCollapse = observer(Collapse)
ObserverCollapse.Header = CollapseHeader
ObserverCollapse.Content = CollapseContent

export default ObserverCollapse
