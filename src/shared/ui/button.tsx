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
  icon: 'bp-btn--icon',
} as const

type ButtonVariant = keyof typeof BUTTON_VARIANTS
type ButtonSize = keyof typeof BUTTON_SIZES

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'default',
    size = 'md',
    type,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn('bp-btn', BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  )
})
