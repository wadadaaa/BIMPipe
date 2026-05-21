import React from 'react'
import { cn } from '@/shared/cn'
import './button.css'

const BUTTON_VARIANTS = {
  default: 'bp-btn--default',
  outline: 'bp-btn--outline',
  ghost: 'bp-btn--ghost',
} as const

const BUTTON_SIZES = {
  sm: 'bp-btn--sm',
  md: 'bp-btn--md',
} as const

const BUTTON_SHAPES = {
  default: 'bp-btn--shape-default',
  square: 'bp-btn--shape-square',
} as const

type ButtonVariant = keyof typeof BUTTON_VARIANTS
type ButtonSize = keyof typeof BUTTON_SIZES
type LegacyButtonSize = ButtonSize | 'icon'
type ButtonShape = keyof typeof BUTTON_SHAPES

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: LegacyButtonSize
  shape?: ButtonShape
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'default',
    size = 'md',
    shape,
    type,
    ...props
  },
  ref,
) {
  const normalizedSize: ButtonSize = size === 'icon' ? 'md' : size
  const normalizedShape: ButtonShape = shape ?? (size === 'icon' ? 'square' : 'default')

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'bp-btn',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[normalizedSize],
        BUTTON_SHAPES[normalizedShape],
        className,
      )}
      {...props}
    />
  )
})
Button.displayName = 'Button'
