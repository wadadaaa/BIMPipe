import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('applies default variant and size classes', () => {
    render(<Button>Default</Button>)
    const button = screen.getByRole('button', { name: 'Default' })

    expect(button).toHaveClass('bp-btn--default')
    expect(button).toHaveClass('bp-btn--md')
    expect(button).toHaveClass('bp-btn--shape-default')
  })

  it('applies explicit variant and size classes', () => {
    render(
      <Button variant="ghost" size="sm" shape="square">
        Compact icon
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Compact icon' })

    expect(button).toHaveClass('bp-btn--ghost')
    expect(button).toHaveClass('bp-btn--sm')
    expect(button).toHaveClass('bp-btn--shape-square')
  })

  it('defaults native type to button', () => {
    render(<Button>Action</Button>)
    expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute('type', 'button')
  })

  it('allows type submit override', () => {
    render(<Button type="submit">Submit</Button>)
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit')
  })

  it('passes custom className through', () => {
    render(<Button className="my-btn">Styled</Button>)
    expect(screen.getByRole('button', { name: 'Styled' })).toHaveClass('my-btn')
  })

  it('forwards ref to underlying HTMLButtonElement', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Ref target</Button>)

    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Ref target' }))
  })
})
