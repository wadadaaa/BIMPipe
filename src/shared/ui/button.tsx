import * as React from 'react'
import { cn } from '@/shared/cn'
import './button.css'

export type ButtonVariant = 'default' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'icon'

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bp-btn--default',
  outline: 'bp-btn--outline',
  ghost: 'bp-btn--ghost',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'bp-btn--sm',
  md: 'bp-btn--md',
  icon: 'bp-btn--icon',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

      <button
        ref={ref}
        type={type}
        className={cn('bp-btn', variantClasses[variant], sizeClasses[size], className)}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'
