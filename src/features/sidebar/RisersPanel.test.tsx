import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RisersPanel } from './RisersPanel'
import type { Riser, Storey } from '@/domain/types'

const LEVEL_1: Storey = { id: 2, name: 'Level 1', elevation: 0, modelId: 'host' }

function makeRiser(overrides: Partial<Riser> = {}): Riser {
  return { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: LEVEL_1.id, position: { x: 1, y: 0, z: 2 }, ...overrides }
}

const baseProps = {
  fixtures: [],
  kitchens: [],
  isAddingRiser: false,
  onToggleAddMode: () => {},
  onSuggestRisers: () => {},
  onRemove: () => {},
}

describe('RisersPanel drawing preview (G1)', () => {
  it('hides the button when no preview callback is wired', () => {
    render(<RisersPanel {...baseProps} risers={[makeRiser()]} />)
    expect(screen.queryByRole('button', { name: /drawing preview/i })).not.toBeInTheDocument()
  })

  it('is disabled with a reason while the floor has no risers', async () => {
    const onDrawingPreview = vi.fn(() => null)
    render(<RisersPanel {...baseProps} risers={[]} onDrawingPreview={onDrawingPreview} />)

    const button = screen.getByRole('button', { name: /drawing preview/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/place or suggest risers first/i))
    await userEvent.click(button)
    expect(onDrawingPreview).not.toHaveBeenCalled()
    expect(screen.queryByText(/drawing preview failed/i)).not.toBeInTheDocument()
  })

  it('calls the preview callback for the active storey on click and shows no error on success', async () => {
    // The page binds the active storey into the callback (WorkspacePage.handleDrawingPreview);
    // the panel's contract is to invoke that closure once per click and treat null as success.
    const previewedStoreys: string[] = []
    const activeStorey = LEVEL_1
    const onDrawingPreview = vi.fn(() => {
      previewedStoreys.push(activeStorey.name)
      return null
    })
    render(<RisersPanel {...baseProps} risers={[makeRiser({ storeyId: activeStorey.id })]} onDrawingPreview={onDrawingPreview} />)

    const button = screen.getByRole('button', { name: /drawing preview/i })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/sanitary plan drawing \(SVG, 1:50\)/i))
    await userEvent.click(button)

    expect(onDrawingPreview).toHaveBeenCalledTimes(1)
    expect(previewedStoreys).toEqual(['Level 1'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the reason when the preview reports a failure, and clears it on a later success', async () => {
    const onDrawingPreview = vi.fn<() => string | null>().mockReturnValueOnce('Open a floor first.').mockReturnValueOnce(null)
    render(<RisersPanel {...baseProps} risers={[makeRiser()]} onDrawingPreview={onDrawingPreview} />)

    const button = screen.getByRole('button', { name: /drawing preview/i })
    await userEvent.click(button)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Drawing preview failed: Open a floor first.')
    expect(alert).toHaveAttribute('dir', 'auto')

    await userEvent.click(button)
    expect(onDrawingPreview).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
