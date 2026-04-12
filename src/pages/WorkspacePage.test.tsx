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
  exportIfcWithRisers: vi.fn(),
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

vi.mock('@/shared/ifc/exportIfcWithRisers', () => ({
  exportIfcWithRisers: mocks.exportIfcWithRisers,
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
      { id: 2, name: 'Level 2', elevation: 612, modelId: 'model-1' },
      { id: 3, name: 'Level 3', elevation: 918, modelId: 'model-1' },
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
    mocks.exportIfcWithRisers.mockResolvedValue(new Uint8Array([5, 4, 3]))
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
    mocks.exportIfcWithRisers.mockReset()
  })

  it('supports upload, floor open, riser deletion, and IFC export in the first V0 slice', async () => {
    const user = userEvent.setup()
    render(<WorkspacePage />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await user.upload(input!, new File([new ArrayBuffer(128)], 'tower.ifc'))

    const levelTwoButton = await screen.findByRole('button', { name: /level 2/i })
    await user.click(levelTwoButton)

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

    await user.click(screen.getByRole('button', { name: /download ifc/i }))

    await waitFor(() => {
      expect(mocks.exportIfcWithRisers).toHaveBeenCalledTimes(1)
    })

    const [api, sourceBytes, primaryStoreyId, risers] = mocks.exportIfcWithRisers.mock.calls[0]
    expect(api).toMatchObject({ OpenModel: expect.any(Function), CloseModel: expect.any(Function) })
    expect(sourceBytes).toBeInstanceOf(Uint8Array)
    expect(primaryStoreyId).toBe(2)
    expect(risers).toHaveLength(4)
    expect(new Set(risers.map((riser: { stackLabel: string }) => riser.stackLabel))).toEqual(
      new Set(['R1', 'R3']),
    )
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })
})
