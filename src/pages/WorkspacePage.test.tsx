import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspacePage } from './WorkspacePage'

const mocks = vi.hoisted(() => ({
  getIfcApi: vi.fn(),
  parseStoreys: vi.fn(),
  extractFloorMeshes: vi.fn(),
  detectFixtures: vi.fn(),
  detectKitchens: vi.fn(),
  exportFullIfcWithRisers: vi.fn(),
  exportFullIfcWithRisersWithDebug: vi.fn(),
}))

vi.mock('@/shared/ifc/ifcApi', () => ({
  getIfcApi: mocks.getIfcApi,
}))

vi.mock('@/shared/ifc/parseStoreys', () => ({
  parseStoreys: mocks.parseStoreys,
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

vi.mock('@/shared/ifc/exportFullIfcWithRisers', () => ({
  exportFullIfcWithRisers: mocks.exportFullIfcWithRisers,
  exportFullIfcWithRisersWithDebug: mocks.exportFullIfcWithRisersWithDebug,
}))

vi.mock('@/viewer/FloorViewer', () => ({
  FloorViewer: ({
    fixtures,
    kitchens,
    risers,
  }: {
    fixtures?: Array<unknown>
    kitchens?: Array<unknown>
    risers?: Array<unknown>
  }) => (
    <div data-testid="floor-viewer">
      <span>fixtures:{fixtures?.length ?? 0}</span>
      <span>kitchens:{kitchens?.length ?? 0}</span>
      <span>risers:{risers?.length ?? 0}</span>
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
    HTMLAnchorElement.prototype.click = originalAnchorClick
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    mocks.getIfcApi.mockReset()
    mocks.parseStoreys.mockReset()
    mocks.extractFloorMeshes.mockReset()
    mocks.detectFixtures.mockReset()
    mocks.detectKitchens.mockReset()
    mocks.exportFullIfcWithRisers.mockReset()
    mocks.exportFullIfcWithRisersWithDebug.mockReset()
  })

  it('auto-opens קומה 2 instead of מרתף 2 after upload and supports riser deletion and IFC export', async () => {
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

    await screen.findByLabelText('Remove riser R1')
    await screen.findByLabelText('Remove riser R2')
    await screen.findByLabelText('Remove riser R3')

    expect(screen.getByTestId('floor-viewer')).toHaveTextContent('fixtures:2')
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
    expect(risers).toHaveLength(6)
    expect(new Set(risers.map((riser: { stackLabel: string }) => riser.stackLabel))).toEqual(
      new Set(['R1', 'R3']),
    )
    expect(anchorClick).toHaveBeenCalledTimes(2)
  })

  it('exposes one validated IFC download option that writes IFC and debug mapping', async () => {
    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'tower.ifc'))

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
    expect(risers).toHaveLength(9)
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
})
