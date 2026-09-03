import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StoreyList } from './StoreyList'
import type { Storey } from '@/domain/types'

// Elevations are raw IFC attribute values in the model's declared unit
// (mm here), per the units contract in `src/shared/lengthUnits.ts`.
const storeys: Storey[] = [
  { id: 1, name: 'Ground Floor', elevation: 0, modelId: 'm1' },
  { id: 2, name: 'Level 1', elevation: 3000, modelId: 'm1' },
  { id: 3, name: 'Level 2', elevation: 6000, modelId: 'm1' },
]

describe('StoreyList', () => {
  it('renders nothing when storeys array is empty', () => {
    const { container } = render(
      <StoreyList storeys={[]} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a button for each storey', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('renders highest storey first (reversed elevation order)', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('Level 2')
    expect(buttons[2]).toHaveTextContent('Ground Floor')
  })

  it('formats elevations of a declared-mm model as metres', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    expect(screen.getByRole('button', { name: /Level 1/ })).toHaveTextContent('3.00 m')
    expect(screen.getByRole('button', { name: /Level 2/ })).toHaveTextContent('6.00 m')
    expect(screen.getByRole('button', { name: /Ground Floor/ })).toHaveTextContent('0.00 m')
  })

  it('formats elevations of a declared-cm model as metres (the 096 regression)', () => {
    const cmStoreys: Storey[] = [{ id: 1, name: 'Storey 01', elevation: 3015, modelId: 'm1' }]
    render(
      <StoreyList storeys={cmStoreys} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit="cm" />,
    )
    expect(screen.getByRole('button', { name: /Storey 01/ })).toHaveTextContent('30.15 m')
  })

  it('shows the raw number with no unit suffix when the model declares no unit', () => {
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={vi.fn()} modelLengthUnit={null} />,
    )
    const level1 = screen.getByRole('button', { name: /Level 1/ })
    expect(level1).toHaveTextContent('3,000')
    expect(level1.textContent).not.toMatch(/\d\s*(mm|m)\b/)
  })

  it('marks the selected storey', () => {
    render(
      <StoreyList storeys={storeys} selectedId={2} isLoading={false} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    const selected = screen.getByRole('button', { name: /Level 1/ })
    expect(selected).toHaveClass('storey-list__item--selected')
  })

  it('calls onSelect with the storey id when a button is clicked', async () => {
    const onSelect = vi.fn()
    render(
      <StoreyList storeys={storeys} selectedId={null} isLoading={false} onSelect={onSelect} modelLengthUnit="mm" />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Ground Floor/ }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('disables all buttons while loading', () => {
    render(
      <StoreyList storeys={storeys} selectedId={1} isLoading={true} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled()
    }
  })

  it('shows a loading indicator on the selected floor while loading', () => {
    render(
      <StoreyList storeys={storeys} selectedId={2} isLoading={true} onSelect={vi.fn()} modelLengthUnit="mm" />,
    )

    expect(screen.getByLabelText('Loading Level 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Level 1/i })).toHaveClass('storey-list__item--loading')
  })
})
