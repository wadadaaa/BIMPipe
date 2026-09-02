import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspacePage } from './WorkspacePage'

const mocks = vi.hoisted(() => ({
  getIfcApi: vi.fn(),
  parseStoreys: vi.fn(),
  resolveModelLengthUnit: vi.fn(),
  extractFloorMeshes: vi.fn(),
  detectFixtures: vi.fn(),
  detectKitchens: vi.fn(),
  exportFullIfcWithRisers: vi.fn(),
  exportFullIfcWithRisersWithDebug: vi.fn(),
  getDemoRuntimeConfig: vi.fn(),
  chooseInitialStoreyByFixtures: vi.fn(),
  extractEngineerPipeNetwork: vi.fn(),
}))

vi.mock('@/shared/ifc/ifcApi', () => ({
  getIfcApi: mocks.getIfcApi,
}))

vi.mock('@/shared/ifc/parseStoreys', () => ({
  parseStoreys: mocks.parseStoreys,
}))

vi.mock('@/shared/ifc/resolveModelLengthUnit', () => ({
  resolveModelLengthUnit: mocks.resolveModelLengthUnit,
}))

vi.mock('@/shared/ifc/extractFloorMeshes', () => ({
  extractFloorMeshes: mocks.extractFloorMeshes,
}))

vi.mock('@/shared/ifc/detectFixtures', () => ({
  detectFixtures: mocks.detectFixtures,
}))

vi.mock('@/shared/ifc/detectKitchens', () => ({
  detectKitchens: mocks.detectKitchens,
}))

vi.mock('@/shared/ifc/scanStoreyFixtures', () => ({
  chooseInitialStoreyByFixtures: mocks.chooseInitialStoreyByFixtures,
}))

vi.mock('@/shared/ifc/exportFullIfcWithRisers', () => ({
  exportFullIfcWithRisers: mocks.exportFullIfcWithRisers,
  exportFullIfcWithRisersWithDebug: mocks.exportFullIfcWithRisersWithDebug,
}))

vi.mock('@/shared/ifc/extractEngineerPipeNetwork', () => ({
  extractEngineerPipeNetwork: mocks.extractEngineerPipeNetwork,
}))

vi.mock('@/shared/demoConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/demoConfig')>()
  return {
    ...actual,
    getDemoRuntimeConfig: mocks.getDemoRuntimeConfig,
  }
})

const demoEnabledRuntime = {
  enabled: true as const,
  config: {
    name: 'ADAM_10 test demo',
    model: { fileName: 'tower.ifc', schema: 'IFC2X3', source: 'test', assetPath: 'test' },
    scope: { includedFloors: ['קומה 2'], excludedFloors: [] },
    routing: { mode: 'demo' as const, allowManualRiserSelection: true },
  },
}

vi.mock('@/viewer/FloorViewer', () => ({
  FloorViewer: ({
    fixtures,
    kitchens,
    risers,
    sanitaryRoutes,
    branchRouteSegments,
    branchRoutesVisible,
    onToggleBranchRoutes,
    engineerSegments,
    engineerStackMarkers,
    onToggleEngineerOverlay,
  }: {
    fixtures?: Array<unknown>
    kitchens?: Array<unknown>
    risers?: Array<unknown>
    sanitaryRoutes?: Array<unknown>
    branchRouteSegments?: Array<unknown>
    branchRoutesVisible?: boolean
    onToggleBranchRoutes?: () => void
    engineerSegments?: Array<unknown>
    engineerStackMarkers?: Array<unknown>
    onToggleEngineerOverlay?: () => void
  }) => (
    <div data-testid="floor-viewer">
      <span>fixtures:{fixtures?.length ?? 0}</span>
      <span>kitchens:{kitchens?.length ?? 0}</span>
      <span>risers:{risers?.length ?? 0}</span>
      <span>routes:{sanitaryRoutes?.length ?? 0}</span>
      {/* Mirrors the real viewer: hidden floors draw zero branch segments. */}
      <span>branchSegments:{branchRoutesVisible === false ? 0 : (branchRouteSegments?.length ?? 0)}</span>
      {/* The page passes empty arrays when the engineer layer is toggled off. */}
      <span>engineerSegments:{engineerSegments?.length ?? 0}</span>
      <span>engineerStacks:{engineerStackMarkers?.length ?? 0}</span>
      <button type="button" onClick={onToggleBranchRoutes}>
        toggle-branch-routes
      </button>
      <button type="button" onClick={onToggleEngineerOverlay}>
        toggle-engineer-overlay
      </button>
    </div>
  ),
}))

describe('WorkspacePage', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  const originalAnchorClick = HTMLAnchorElement.prototype.click
  const anchorClick = vi.fn()

  beforeEach(() => {
    anchorClick.mockReset()
    HTMLAnchorElement.prototype.click = anchorClick

    mocks.getDemoRuntimeConfig.mockReturnValue(demoEnabledRuntime)

    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()

    const api = {
      OpenModel: vi.fn(() => 101),
      CloseModel: vi.fn(),
    }

    mocks.getIfcApi.mockResolvedValue(api)
    mocks.resolveModelLengthUnit.mockResolvedValue('mm')
    // Plain-mode auto-select goes through the fixture chooser; keep the mocked
    // choice on קומה 2 so plain-mode flows open the same floor as before.
    mocks.chooseInitialStoreyByFixtures.mockResolvedValue({
      storeyId: 2,
      storeyName: 'קומה 2',
      reason: 'Lowest of 1 toilet-bearing storeys sharing fixture fingerprint "TOILETPAN:2" (test).',
      scanMs: 5,
    })
    mocks.parseStoreys.mockResolvedValue([
      { id: 102, name: 'מרתף 2', elevation: -600, modelId: 'model-1' },
      { id: 2, name: 'קומה 2', elevation: 612, modelId: 'model-1' },
      { id: 3, name: 'קומה 3', elevation: 918, modelId: 'model-1' },
    ])
    mocks.extractFloorMeshes.mockResolvedValue({
      group: null,
      boundingBox: {
        min: { x: 0, z: 0 },
        max: { x: 1200, z: 1200 },
      },
    })
    mocks.detectFixtures.mockResolvedValue([
      { expressId: 11, name: 'WC-11', kind: 'TOILETPAN', storeyId: 2, position: { x: 100, y: 612, z: 100 } },
      { expressId: 12, name: 'WC-12', kind: 'TOILETPAN', storeyId: 2, position: { x: 400, y: 612, z: 400 } },
      { expressId: 13, name: 'Bath-13', kind: 'BATH', storeyId: 2, position: { x: 800, y: 612, z: 800 } },
    ])
    mocks.detectKitchens.mockResolvedValue([
      {
        expressId: 21,
        name: 'Kitchen-21',
        storeyId: 2,
        position: { x: 900, y: 612, z: 900 },
        planBounds: { minX: 800, maxX: 1000, minZ: 800, maxZ: 1000 },
        planCorners: [
          { x: 780, z: 840 },
          { x: 960, z: 780 },
          { x: 1020, z: 960 },
          { x: 840, z: 1020 },
        ],
      },
    ])
    mocks.exportFullIfcWithRisers.mockResolvedValue(new Uint8Array([8, 7, 6]))
    mocks.exportFullIfcWithRisersWithDebug.mockResolvedValue({
      ifcBytes: new Uint8Array([8, 7, 6]),
      debugMapping: {
        exportRunId: 'test-run',
        timestamp: '2026-04-27T00:00:00.000Z',
        sourceIfcName: 'tower.ifc',
        schema: 'IFC2X3',
        sourceFloorPlanBounds: { minX: 0, maxX: 1200, minZ: 0, maxZ: 1200 },
        risers: [],
        warnings: [],
        notes: [],
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    HTMLAnchorElement.prototype.click = originalAnchorClick
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    mocks.getIfcApi.mockReset()
    mocks.parseStoreys.mockReset()
    mocks.resolveModelLengthUnit.mockReset()
    mocks.extractFloorMeshes.mockReset()
    mocks.detectFixtures.mockReset()
    mocks.detectKitchens.mockReset()
    mocks.exportFullIfcWithRisers.mockReset()
    mocks.exportFullIfcWithRisersWithDebug.mockReset()
    mocks.getDemoRuntimeConfig.mockReset()
    mocks.chooseInitialStoreyByFixtures.mockReset()
    mocks.extractEngineerPipeNetwork.mockReset()
  })

  it('auto-opens קומה 2 instead of מרתף 2 and excludes penthouse floor from auto-generated risers by default', async () => {
    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'tower.ifc'))

    const levelTwoButton = await screen.findByRole('button', { name: /קומה 2/i })
    await waitFor(() => {
      expect(levelTwoButton).toHaveClass('storey-list__item--selected')
    })
    expect(mocks.extractFloorMeshes).toHaveBeenCalledWith(expect.anything(), 101, 2)
    // Demo mode keeps its legacy floor-selection semantics: the fixture-scan
    // chooser must never run in the demo flow.
    expect(mocks.chooseInitialStoreyByFixtures).not.toHaveBeenCalled()

    // Detection and placement are split — risers only appear after the user
    // explicitly clicks Place risers in the fixtures panel.
    const placeRisersButton = await screen.findByRole('button', { name: /place risers/i })
    await user.click(placeRisersButton)

    await screen.findByLabelText('Remove riser R1')
    await screen.findByLabelText('Remove riser R2')
    await screen.findByLabelText('Remove riser R3')

    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('Route demo flow')
    // T2: the detected bath is carried through state and routes to the kitchen
    // riser immediately after placement, so the demo flow is already exportable.
    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('Ready to export')
    expect(screen.getByText('ADAM_10 floor opened').closest('li')).toHaveClass('risers-panel__demo-step--done')
    expect(screen.getByText('Sanitary inputs checked').closest('li')).toHaveClass('risers-panel__demo-step--done')
    expect(screen.getByText('Risers selected').closest('li')).toHaveClass('risers-panel__demo-step--done')
    expect(screen.getByText('Route preview generated').closest('li')).toHaveClass('risers-panel__demo-step--done')
    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('WC routes use Ø110 intent')
    expect(screen.getByLabelText('Sanitary demo flow')).toHaveTextContent('2.0% slope toward the riser')

    // All detected fixtures (2 toilets + 1 bath) reach the viewer, not only toilets.
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('fixtures:3')
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('kitchens:1')
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('risers:3')

    await user.click(screen.getByLabelText('Remove riser R2'))

    await waitFor(() => {
      expect(screen.queryByLabelText('Remove riser R2')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Remove riser R1')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove riser R3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^download ifc$/i }))

    await waitFor(() => {
      expect(mocks.exportFullIfcWithRisersWithDebug).toHaveBeenCalledTimes(1)
    })

    const [api, sourceBytes, primaryStoreyId, risers] = mocks.exportFullIfcWithRisersWithDebug.mock.calls[0]
    expect(api).toMatchObject({ OpenModel: expect.any(Function), CloseModel: expect.any(Function) })
    expect(sourceBytes).toBeInstanceOf(Uint8Array)
    expect(primaryStoreyId).toBe(2)
    // Auto-placement is generated on the selected floor only in this flow.
    // Basement/roof/penthouse exclusions matter for cross-floor expansion paths,
    // but this selected-floor test should keep exactly two TOILETPAN-derived risers.
    expect(risers).toHaveLength(2)
    expect(new Set(risers.map((riser: { stackLabel: string }) => riser.stackLabel))).toEqual(
      new Set(['R1', 'R3']),
    )
    // Removing R2 above is a logged manual adjustment, so the export offers
    // three files: the IFC, the debug mapping, and the adjustments JSON.
    expect(anchorClick).toHaveBeenCalledTimes(3)
    const downloadNames = anchorClick.mock.contexts.map(
      (anchor) => (anchor as HTMLAnchorElement).download,
    )
    expect(downloadNames[2]).toBe('tower.adjustments.json')
  })

  it('writes IFC + debug mapping and keeps basement/roof/penthouse exclusions explicit in counts', async () => {
    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'tower.ifc'))

    const placeRisersButton = await screen.findByRole('button', { name: /place risers/i })
    await user.click(placeRisersButton)

    await screen.findByLabelText('Remove riser R1')

    expect(screen.queryByRole('button', { name: /download plumbing ifc/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download full ifc/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^download ifc$/i }))

    await waitFor(() => {
      expect(mocks.exportFullIfcWithRisersWithDebug).toHaveBeenCalledTimes(1)
    })

    const [, sourceBytes, primaryStoreyId, risers, floorBounds, debugOptions] =
      mocks.exportFullIfcWithRisersWithDebug.mock.calls[0]
    expect(sourceBytes).toBeInstanceOf(Uint8Array)
    expect(primaryStoreyId).toBe(2)
    // Selected-floor generation keeps one riser per detected anchor on Level 2
    // (2 TOILETPAN fixtures + 1 kitchen anchor = 3 total).
    expect(risers).toHaveLength(3)
    expect(floorBounds).toEqual({ minX: 0, maxX: 1200, minZ: 0, maxZ: 1200 })
    expect(debugOptions).toMatchObject({
      sourceIfcName: 'tower.ifc',
      storeys: [
        { id: 102, name: 'מרתף 2', elevation: -600 },
        { id: 2, name: 'קומה 2', elevation: 612 },
        { id: 3, name: 'קומה 3', elevation: 918 },
      ],
    })
    expect(debugOptions.exportRunId).toEqual(expect.any(String))
    expect(debugOptions.timestamp).toEqual(expect.any(String))
    expect(anchorClick).toHaveBeenCalledTimes(2)
    expect(
      anchorClick.mock.contexts.map((link) => (link as HTMLAnchorElement).download),
    ).toEqual(['tower-2-full.ifc', 'tower-2-full-riser-mapping.json'])

    const downloadedFileNames = anchorClick.mock.contexts.map((link) => (link as HTMLAnchorElement).download)
    const debugDownloadIndex = downloadedFileNames.indexOf('tower-2-full-riser-mapping.json')
    expect(debugDownloadIndex).toBeGreaterThanOrEqual(0)
    const downloadedDebugBlob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[debugDownloadIndex][0] as Blob
    const downloadedDebugJson = JSON.parse(await downloadedDebugBlob.text()) as {
      sanitaryRouteDebugGroups?: Array<{
        routeGroupId: string
        targetRiserId: string
        selectedMain?: unknown
        branchCount: number
        diameters: number[]
        skippedFixtureIds: number[]
        fallbackReasons: string[]
      }>
      sanitaryRouteLimitations?: string[]
    }
    expect(downloadedDebugJson.sanitaryRouteDebugGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeGroupId: expect.any(String),
          targetRiserId: expect.any(String),
          branchCount: expect.any(Number),
          diameters: expect.any(Array),
          skippedFixtureIds: expect.any(Array),
          fallbackReasons: expect.any(Array),
        }),
      ]),
    )
    expect(downloadedDebugJson.sanitaryRouteLimitations).toEqual([
      ...new Set(downloadedDebugJson.sanitaryRouteLimitations ?? []),
    ])
  })

  it('does not auto-open negative floor labels like קומה -2 when there is no above-ground floor 2', async () => {
    mocks.parseStoreys.mockResolvedValueOnce([
      { id: 102, name: 'קומה -2', elevation: -600, modelId: 'model-1' },
      { id: 3, name: 'קומה 3', elevation: 918, modelId: 'model-1' },
    ])

    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'tower.ifc'))

    await screen.findByRole('button', { name: /קומה -2/i })
    await screen.findByRole('button', { name: /קומה 3/i })

    await waitFor(() => {
      expect(mocks.extractFloorMeshes).not.toHaveBeenCalled()
    })
    expect(screen.getByText(/no active floor/i)).toBeInTheDocument()
  })

  it('plain mode auto-opens the chooser-selected storey and surfaces its reason in Decisions', async () => {
    mocks.getDemoRuntimeConfig.mockReturnValue({ enabled: false as const })
    // The chooser picks קומה 3 — NOT the "floor named 2" the legacy heuristic
    // would pick — proving the open-model flow follows the fixture chooser.
    mocks.chooseInitialStoreyByFixtures.mockResolvedValue({
      storeyId: 3,
      storeyName: 'קומה 3',
      reason: 'Distinctive chooser test reason for the decisions surface.',
      scanMs: 7,
    })

    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'anytower.ifc'))

    const levelThreeButton = await screen.findByRole('button', { name: /קומה 3/i })
    await waitFor(() => {
      expect(levelThreeButton).toHaveClass('storey-list__item--selected')
    })
    expect(mocks.extractFloorMeshes).toHaveBeenCalledWith(expect.anything(), 101, 3)
    expect(mocks.chooseInitialStoreyByFixtures).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('tab', { name: 'Decisions' }))
    expect(await screen.findByText(/Auto-opened floor:/)).toBeInTheDocument()
    expect(screen.getByText(/Distinctive chooser test reason/)).toBeInTheDocument()
    expect(screen.getByText(/Fixture scan took 7 ms/)).toBeInTheDocument()
  })

  it('computes and surfaces sanitary routes without demo mode once fixtures and risers exist on the floor', async () => {
    mocks.getDemoRuntimeConfig.mockReturnValue({ enabled: false as const })

    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    // Non-demo mode accepts any file name (no demo upload restriction).
    await user.upload(input!, new File([new ArrayBuffer(128)], 'anytower.ifc'))

    const levelTwoButton = await screen.findByRole('button', { name: /קומה 2/i })
    await waitFor(() => {
      expect(levelTwoButton).toHaveClass('storey-list__item--selected')
    })

    const placeRisersButton = await screen.findByRole('button', { name: /place risers/i })
    await user.click(placeRisersButton)

    await screen.findByLabelText('Remove riser R1')
    await screen.findByLabelText('Remove riser R2')
    await screen.findByLabelText('Remove riser R3')

    // Suggested toilet risers sit exactly on the toilets, so their routes are
    // degenerate (zero plan length) and skipped. The bath (T2: all fixtures flow
    // through routing) already yields one real branch route to the kitchen riser.
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('routes:1')

    // Removing R2 rebinds WC-12 to R1, which yields a second real
    // fixture-to-riser route with no demo mode active.
    await user.click(screen.getByLabelText('Remove riser R2'))

    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('routes:2')
    })

    // Demo-only chrome stays hidden, but the routing limitations surface in dev.
    expect(screen.queryByLabelText('Sanitary demo flow')).not.toBeInTheDocument()
    expect(screen.getByText('Sanitary routing preview notes')).toBeInTheDocument()
    expect(
      screen.getByText(/verify grouping before using this demo heuristic with anytower\.ifc/i),
    ).toBeInTheDocument()
  })

  it('loads the bundled sample model through the same upload path as a user-picked file', async () => {
    mocks.getDemoRuntimeConfig.mockReturnValue({ enabled: false as const })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(128),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<WorkspacePage />)

    await user.click(screen.getByRole('button', { name: /duplex mep/i }))

    // The sample flows through handleFileAccepted: parse, auto-open, same as an upload.
    const levelTwoButton = await screen.findByRole('button', { name: /קומה 2/i })
    await waitFor(() => {
      expect(levelTwoButton).toHaveClass('storey-list__item--selected')
    })
    expect(fetchMock).toHaveBeenCalledWith('/samples/Duplex_MEP_20110907.ifc')
    expect(mocks.parseStoreys).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('Duplex_MEP_20110907.ifc').length).toBeGreaterThan(0)
  })

  it('hides the sample model affordance in demo mode', () => {
    // beforeEach enables demo mode; the demo only accepts its configured model.
    render(<WorkspacePage />)
    expect(screen.queryByRole('button', { name: /duplex mep/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload ifc file/i })).toBeInTheDocument()
  })

  it('shows branch routes after suggestion and the per-floor toggle hides and re-shows them', async () => {
    mocks.getDemoRuntimeConfig.mockReturnValue({ enabled: false as const })

    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'anytower.ifc'))

    const levelTwoButton = await screen.findByRole('button', { name: /קומה 2/i })
    await waitFor(() => {
      expect(levelTwoButton).toHaveClass('storey-list__item--selected')
    })

    const placeRisersButton = await screen.findByRole('button', { name: /place risers/i })
    await user.click(placeRisersButton)

    await screen.findByLabelText('Remove riser R1')

    // Both toilets sit exactly on their suggested risers (zero-length runs emit no
    // segments); the bath routes to the kitchen corner riser as an axis-aligned
    // L-run, so the dev flow shows its two branch segments right after suggestion.
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('branchSegments:2')

    await user.click(screen.getByRole('button', { name: 'toggle-branch-routes' }))
    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('branchSegments:0')
    })

    await user.click(screen.getByRole('button', { name: 'toggle-branch-routes' }))
    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('branchSegments:2')
    })
  })

  it('loads the engineer network on demand and the per-floor toggle hides and re-shows the layer', async () => {
    mocks.getDemoRuntimeConfig.mockReturnValue({ enabled: false as const })
    // One vertical SW-GRV segment on the auto-opened storey (id 2): drawable as
    // a floor segment and eligible as a riser stack (Ø110, vertical).
    mocks.extractEngineerPipeNetwork.mockResolvedValue({
      metersPerSourceUnit: 1,
      storeys: [{ id: 2, name: 'קומה 2', elevationSource: 612 }],
      segments: [
        {
          expressId: 501,
          name: 'Pipe 501',
          systemName: 'SW-GRV 1',
          storeyId: 2,
          storeyName: 'קומה 2',
          start: { x: 100, y: -50, z: 0 },
          end: { x: 100, y: -50, z: 3 },
          endpointSource: 'extrusion-axis',
          outerDiameterMm: 110,
          lengthM: 3,
          invertElevationM: null,
        },
      ],
    })

    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'anytower.ifc'))

    const levelTwoButton = await screen.findByRole('button', { name: /קומה 2/i })
    await waitFor(() => {
      expect(levelTwoButton).toHaveClass('storey-list__item--selected')
    })

    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerSegments:0')

    await user.click(screen.getByRole('tab', { name: 'Decisions' }))
    await user.click(await screen.findByRole('button', { name: /load engineer network/i }))

    // Baseline summary lands in the Decisions tab; extraction ran on the host.
    await screen.findByText(/1 pipe segment \(SW-GRV \/ VNT\), 1 engineer riser stack/)
    expect(mocks.extractEngineerPipeNetwork).toHaveBeenCalledWith(expect.anything(), 101, {
      systemPrefixes: ['SW-GRV', 'VNT'],
    })

    // Layer is visible by default right after loading.
    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerSegments:1')
    })
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerStacks:1')

    await user.click(screen.getByRole('button', { name: 'toggle-engineer-overlay' }))
    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerSegments:0')
    })
    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerStacks:0')

    await user.click(screen.getByRole('button', { name: 'toggle-engineer-overlay' }))
    await waitFor(() => {
      expect(screen.getByTestId('floor-viewer')).toHaveTextContent('engineerSegments:1')
    })
  })
})
