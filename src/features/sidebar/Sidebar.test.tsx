import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders the two MVP tabs', () => {
    render(<Sidebar activeTab="fixtures" onTabChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /toilets/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /risers/i })).toBeInTheDocument()
  })

  it('marks the active tab as selected', () => {
    render(<Sidebar activeTab="risers" onTabChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /risers/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /toilets/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onTabChange with the selected tab', async () => {
    const onTabChange = vi.fn()
    render(<Sidebar activeTab="fixtures" onTabChange={onTabChange} />)
    await userEvent.click(screen.getByRole('tab', { name: /risers/i }))
    expect(onTabChange).toHaveBeenCalledWith('risers')
  })

  it('shows kitchen and riser summary cards when a floor is open', () => {
    render(
      <Sidebar
        activeTab="fixtures"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        fixtures={[{ expressId: 1, name: 'WC-01', kind: 'TOILETPAN', storeyId: 2, position: null }]}
        kitchens={[{ expressId: 9, name: 'Kitchen-01', storeyId: 2, position: null }]}
        risers={[{ id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 1, y: 0, z: 2 } }]}
      />,
    )

    expect(screen.getAllByText('Toilets').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kitchens').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Risers').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  it('refreshes the riser list when a riser is removed', () => {
    const { rerender } = render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        risers={[
          { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 1, y: 0, z: 2 } },
          { id: 'r2', stackId: 'stack-2', stackLabel: 'R2', storeyId: 2, position: { x: 3, y: 0, z: 4 } },
        ]}
      />,
    )

    expect(screen.getByLabelText('Remove riser R1')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove riser R2')).toBeInTheDocument()

    rerender(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        risers={[{ id: 'r2', stackId: 'stack-2', stackLabel: 'R2', storeyId: 2, position: { x: 3, y: 0, z: 4 } }]}
      />,
    )

    expect(screen.queryByLabelText('Remove riser R1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Remove riser R2')).toBeInTheDocument()
  })

  it('enables IFC download from explicit full-model availability even when the visible floor has no risers', async () => {
    const onDownloadFullIfc = vi.fn()
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="03"
        risers={[]}
        canDownloadIfc
        onDownloadFullIfc={onDownloadFullIfc}
      />,
    )

    expect(screen.getByText(/no risers placed yet/i)).toBeInTheDocument()

    const downloadButton = screen.getByRole('button', { name: /^download ifc$/i })
    expect(downloadButton).toBeEnabled()

    await userEvent.click(downloadButton)
    expect(onDownloadFullIfc).toHaveBeenCalledTimes(1)
  })

  it('disables IFC download when no risers exist anywhere', () => {
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="03"
        risers={[]}
        canDownloadIfc={false}
      />,
    )

    expect(screen.getByRole('button', { name: /^download ifc$/i })).toBeDisabled()
  })
})
