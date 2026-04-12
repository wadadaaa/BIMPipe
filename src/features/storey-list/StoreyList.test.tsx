import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoreyList } from './StoreyList'
import type { Storey } from '@/domain/types'

const storeys: Storey[] = [
  { id: 1, name: 'Ground Floor', elevation: 0, modelId: 'm1' },
  { id: 2, name: 'Level 1', elevation: 3000, modelId: 'm1' },
  { id: 3, name: 'Level 2', elevation: 6000, modelId: 'm1' },
]

describe('StoreyList', () => {
  it('renders nothing when storeys array is empty', () => {
    const { container } = render(
      <StoreyList storeys={[]} selectedId={null} isLoading={false} onSelect={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a button for each storey', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('renders highest storey first (reversed elevation order)', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('Level 2')
    expect(buttons[2]).toHaveTextContent('Ground Floor')
  })

  it('marks the selected storey', () => {
    render(
      <StoreyList storeys={storeys} selectedId={2} isLoading={false} onSelect={vi.fn()} />,
    )
    const selected = screen.getByRole('button', { name: /Level 1/ })
    expect(selected).toHaveClass('storey-list__item--selected')
  })

  it('calls onSelect with the storey id when a button is clicked', async () => {
    const onSelect = vi.fn()
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Ground Floor/ }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('disables all buttons while loading', () => {
    render(
      <StoreyList storeys={storeys} selectedId={1} isLoading={true} onSelect={vi.fn()} />,
    )
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled()
    }
  })

  it('shows a loading indicator on the selected floor while loading', () => {
    render(
      <StoreyList storeys={storeys} selectedId={2} isLoading={true} onSelect={vi.fn()} />,
    )

    expect(screen.getByLabelText('Loading Level 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Level 1/i })).toHaveClass('storey-list__item--loading')
  })
})
