import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders the MVP tabs including decisions', () => {
    render(<Sidebar activeTab="fixtures" onTabChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /fixtures/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /risers/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /decisions/i })).toBeInTheDocument()
  })

  it('marks the active tab as selected', () => {
    render(<Sidebar activeTab="risers" onTabChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /risers/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /fixtures/i })).toHaveAttribute('aria-selected', 'false')
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

    expect(screen.getAllByText('Fixtures').length).toBeGreaterThan(0)
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

  it('shows the ADAM_10 demo floor step only when an included demo floor is open', () => {
    const fixture = { expressId: 1, name: 'WC-01', kind: 'TOILETPAN' as const, storeyId: 2, position: { x: 1, y: 0, z: 2 } }
    const riser = { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 3, y: 0, z: 4 } }
    const { rerender } = render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="03"
        fixtures={[fixture]}
        risers={[riser]}
        demoFlowEnabled
        demoFloorOpened={false}
        sanitaryRouteCount={1}
      />,
    )

    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('Open an included ADAM_10 demo floor')
    expect(screen.getByText('ADAM_10 floor opened').closest('li')).not.toHaveClass('risers-panel__demo-step--done')

    rerender(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="קומה 2"
        fixtures={[fixture]}
        risers={[riser]}
        demoFlowEnabled
        demoFloorOpened
        sanitaryRouteCount={1}
      />,
    )

    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('Ready to export')
    expect(screen.getByText('ADAM_10 floor opened').closest('li')).toHaveClass('risers-panel__demo-step--done')
  })

  it('keeps demo decisions free of raw constants, debug copy, and zero-only rows', () => {
    const validationReport = {
      floorClassifications: [{ storeyId: 2, class: 'standard' }],
      placementDecisions: [],
      validationIssues: [
        {
          code: 'VERTICAL_GROUPING_NOT_AVAILABLE',
          severity: 'warning',
          message: 'Vertical wet-room grouping is unavailable in current flow; grouping and strategy sections are partial.',
        },
      ],
      summary: {
        processedFloorCount: 1,
        skippedFloorCount: 0,
        newlyAddedRiserCount: 7,
        reusedRiserGroupCount: 0,
        coordinationIssueCount: 0,
      },
    }

    render(
      <Sidebar
        activeTab="validation"
        onTabChange={vi.fn()}
        selectedStoreyName="קומה 2"
        validationReport={validationReport as never}
        detectionAggregation={null}
        demoFlowEnabled
      />,
    )

    const panel = screen.getByRole('tabpanel')
    expect(panel).not.toHaveTextContent('VERTICAL_GROUPING_NOT_AVAILABLE')
    expect(panel).not.toHaveTextContent(/debug/i)
    expect(panel).not.toHaveTextContent(/Reused riser groups/i)
    expect(panel).toHaveTextContent('New risers: 7')
  })

  it('labels demo riser positions by nearby fixture instead of raw coordinates', () => {
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        fixtures={[
          { expressId: 1, name: 'אסלה תלויה', kind: 'TOILETPAN', storeyId: 2, position: { x: 100, y: 0, z: 200 } },
        ]}
        risers={[
          { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 125, y: 0, z: 220 } },
        ]}
        demoFlowEnabled
      />,
    )

    expect(screen.getByText(/near WC-1/i)).toBeInTheDocument()
    // W2: coordinates are formatted via the canonical converter with IFC-Y sign.
    expect(screen.queryByText(/125\.00 m, -220\.00 m/)).not.toBeInTheDocument()
  })

  it('keeps exact riser coordinates visible outside demo mode', () => {
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        fixtures={[
          { expressId: 1, name: 'אסלה תלויה', kind: 'TOILETPAN', storeyId: 2, position: { x: 100, y: 0, z: 200 } },
        ]}
        risers={[
          { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 125, y: 0, z: 220 } },
        ]}
      />,
    )

    // W2 intended change: viewer z is -(IFC Y), so the displayed Y is negated,
    // and both components go through the canonical metre formatter (2 decimals).
    expect(screen.getByText('125.00 m, -220.00 m')).toBeInTheDocument()
    expect(screen.queryByText(/near WC-1/i)).not.toBeInTheDocument()
  })

  it('converts raw-mm coordinates to metres when the model unit is unknown (heuristic fallback)', () => {
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        risers={[
          { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 12500, y: 0, z: -3000 } },
        ]}
      />,
    )

    expect(screen.getByText('12.50 m, 3.00 m')).toBeInTheDocument()
  })

  it('treats coordinates as metres when the model length unit is resolved', () => {
    // Positions above the mm heuristic threshold: a resolved model unit means
    // web-ifc already normalized geometry to metres, so no heuristic applies.
    render(
      <Sidebar
        activeTab="risers"
        onTabChange={vi.fn()}
        selectedStoreyName="02"
        modelLengthUnit="cm"
        risers={[
          { id: 'r1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 2, position: { x: 1250, y: 0, z: -300 } },
        ]}
      />,
    )

    expect(screen.getByText('1250.00 m, 300.00 m')).toBeInTheDocument()
  })
})
