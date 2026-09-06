import { describe, expect, it } from 'vitest'
import type { FloorRoutes, RouteSegment } from '@/domain/branchRouting'
import type { ShaftCandidate } from '@/domain/continuityMap'
import type { Fixture, Riser, Storey } from '@/domain/types'
import { buildDrawingPreview, drawingPreviewFileName } from './buildDrawingPreview'

const STOREYS: Storey[] = [
  { id: 100, name: 'Level 1', elevation: 0, modelId: 'host' },
  { id: 200, name: 'Level 2', elevation: 3, modelId: 'host' },
]

const RISERS: Riser[] = [
  { id: 'r-2-1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 200, position: { x: 1, y: 3, z: -1 }, source: 'placed' },
  { id: 'r-1-1', stackId: 'stack-1', stackLabel: 'R1', storeyId: 100, position: { x: 1, y: 0, z: -1 }, source: 'placed' },
]

function segment(id: string, kind: RouteSegment['kind'], start: [number, number], end: [number, number], diameterMm: number): RouteSegment {
  return {
    id,
    start: { x: start[0], z: start[1], elevation: 0.1 },
    end: { x: end[0], z: end[1], elevation: 0 },
    axis: start[0] === end[0] ? 'z' : 'x',
    kind,
    servedFixtureExpressIds: [901],
    diameterMm,
    riserId: 'r-2-1',
    riserStackId: 'stack-1',
  }
}

const ROUTES: FloorRoutes[] = [
  {
    storeyId: 200,
    planUnits: 'm',
    segments: [
      segment('seg|200|1', 'trunk', [3, -1], [1, -1], 63),
      segment('seg|200|0', 'fixture-branch', [3, -4], [3, -1], 110),
    ],
  },
]

const FIXTURES: Fixture[] = [
  { expressId: 901, name: 'WC', kind: 'TOILETPAN', storeyId: 200, position: { x: 3, y: 3.4, z: -4 } },
]

const SHAFTS: ShaftCandidate[] = [
  {
    id: 'shaft-a',
    source: 'shaft-named-space',
    center: { x: 0.5, z: -0.5 },
    bounds: { minX: 0, maxX: 1, minZ: -1, maxZ: 0 },
    polygon: null,
    storeyIds: [100, 200],
  },
  {
    id: 'shaft-b',
    source: 'shaft-named-space',
    center: { x: 7, z: -7 },
    bounds: { minX: 6, maxX: 8, minZ: -8, maxZ: -6 },
    polygon: null,
    storeyIds: [100],
  },
]

function build() {
  return buildDrawingPreview({
    storeyId: 200,
    storeyName: 'Level 2',
    risers: RISERS,
    routes: ROUTES,
    fixtures: FIXTURES,
    planBounds: { minX: -1, maxX: 9, minZ: -8, maxZ: 3 },
    storeys: STOREYS,
    shaftCandidates: SHAFTS,
  })
}

describe('buildDrawingPreview (synthetic page state)', () => {
  it('renders an SVG sheet for the open storey with its risers, runs and fixtures', () => {
    const preview = build()
    expect(preview.svg.startsWith('<?xml')).toBe(true)
    expect(preview.svg).toContain('<svg')
    expect(preview.svg).toContain('Level 2')
    expect(preview.svg).toContain('1:50')
    expect(preview.svg).toContain('data-label-for="our-pipe-seg|200|1"')
    expect(preview.diagnostics.risers.onStorey).toBe(1)
    expect(preview.diagnostics.pipes.drawn).toBe(2)
    expect(preview.diagnostics.fixtures.drawn).toBe(1)
    expect(preview.svg).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('passes only the shaft candidates present on the storey as structure', () => {
    const preview = build()
    expect(preview.diagnostics.structure.elements).toBe(1)
  })

  it('names the file after the storey and keeps non-Latin storey names', () => {
    expect(build().fileName).toBe('Level-2-sanitary-drawing.svg')
    expect(drawingPreviewFileName(' קומה 2 / א ')).toBe('קומה-2-א-sanitary-drawing.svg')
    expect(drawingPreviewFileName('   ')).toBe('storey-sanitary-drawing.svg')
  })

  it('is deterministic for the same page state', () => {
    expect(build().svg).toBe(build().svg)
  })
})
