import React, { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { observer, u } from 'startupjs'
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import propTypes from 'prop-types'
import STYLES from './index.styl'

const { colors } = STYLES

const SIZES = {
  xs: u(1),
  s: u(1.5),
  m: u(2),
  l: u(2.5),
  xl: u(3),
  xxl: u(3.5)
}

function Icon ({
  style,
  icon,
  color,
  size,
  ...props
}) {
  if (!icon) return null
  if (/^#|rgb/.test(color)) console.warn('Icon component: Hex color for color property is deprecated. Use style instead')

  const _size = useMemo(() => SIZES[size] || size, [size])
  const _color = useMemo(() => {
    return colors[color] || color
  }, [color])

  // Pass color as part of style to allow color override from the outside
  style = StyleSheet.flatten([{ color: _color }, style])

  // TODO VITE fix custom svg
  if (typeof icon === 'function') {
    const CustomIcon = icon
    return pug`
      CustomIcon(
        style=style
        width=_size
        height=_size
        fill=style.color
        ...props
      )
    `
  }

  return pug`
    FontAwesomeIcon(
      style=style
      icon=icon
      color=style.color
      size=_size
      ...props
    )
  `
}

Icon.defaultProps = {
  size: 'm',
  color: 'dark'
}

Icon.propTypes = {
  style: propTypes.oneOfType([propTypes.object, propTypes.array]),
  icon: propTypes.oneOfType([propTypes.object, propTypes.func]),
  color: propTypes.string,
  size: propTypes.oneOfType([
    propTypes.oneOf(Object.keys(SIZES)),
    propTypes.number
  ])
}

export default observer(Icon)
