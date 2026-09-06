import type { DrawingFixture, DrawingPipeRun, DrawingStructureElement, FloorDrawingModel } from './floorDrawingModel'

/**
 * Synthetic floor models for tests and style calibration. Nothing here comes
 * from a client file: the geometry is invented.
 */

function rect(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { xM: minX, yM: minY },
    { xM: maxX, yM: minY },
    { xM: maxX, yM: maxY },
    { xM: minX, yM: maxY },
  ] as const
}

/**
 * A toilet block: 6 WCs in a row against the top wall with stall partitions,
 * 4 basins along the bottom wall, one floor drain, a shaft outside the right
 * wall holding the sanitary stack, a vent stack in a duct outside the left
 * wall. The WC collector and the basin collector both cross the right wall;
 * the vent run crosses the left wall — three wall crossings in total.
 */
export function buildSyntheticToiletBlockModel(): FloorDrawingModel {
  const structure: DrawingStructureElement[] = [
    { kind: 'wall', outline: rect(-0.2, -0.2, 7.4, 0) },
    { kind: 'wall', outline: rect(-0.2, 3.0, 7.4, 3.2) },
    { kind: 'wall', outline: rect(-0.2, 0, 0, 3.0) },
    { kind: 'wall', outline: rect(7.2, 0, 7.4, 3.0) },
    // shaft enclosure: two thin walls, the room wall closes the third side and
    // the fourth (bottom) side is the access opening the basin leg enters through
    { kind: 'wall', outline: rect(8.3, 1.4, 8.4, 2.2) },
    { kind: 'wall', outline: rect(7.4, 2.1, 8.4, 2.2) },
    { kind: 'column', outline: rect(7.4, 3.0, 7.8, 3.4) },
    { kind: 'slab-opening', outline: rect(7.5, 1.5, 8.3, 2.1) },
    { kind: 'shaft-candidate', outline: rect(-0.7, 1.5, -0.2, 2.1) },
  ]
  for (let i = 0; i < 5; i++) {
    const x = 1.0 + 0.9 * i
    structure.push({ kind: 'wall', outline: rect(x, 2.0, x + 0.1, 3.0) })
  }

  const fixtures: DrawingFixture[] = []
  const pipes: DrawingPipeRun[] = []
  for (let i = 0; i < 6; i++) {
    const x = 0.6 + 0.9 * i
    fixtures.push({ id: `wc-${i + 1}`, kind: 'toilet', centre: { xM: x, yM: 2.65 }, rotationDeg: 180 })
    pipes.push({
      id: `wc-branch-${i + 1}`,
      system: 'sanitary',
      diameterMm: 110,
      slopePercent: 2,
      start: { xM: x, yM: 2.65 },
      end: { xM: x, yM: 1.8 },
      role: 'branch',
    })
  }
  for (let i = 0; i < 4; i++) {
    const x = 0.8 + 0.7 * i
    fixtures.push({ id: `basin-${i + 1}`, kind: 'basin', centre: { xM: x, yM: 0.25 }, rotationDeg: 0 })
    pipes.push({
      id: `basin-branch-${i + 1}`,
      system: 'sanitary',
      diameterMm: 50,
      slopePercent: 2,
      start: { xM: x, yM: 0.25 },
      end: { xM: x, yM: 0.6 },
      role: 'branch',
    })
  }
  // The floor drain joins the collector obliquely (a 45° wye), like a real
  // sheet's angled branches; it also exercises rotated labels.
  fixtures.push({ id: 'fd-1', kind: 'floor-drain', centre: { xM: 3.6, yM: 1.0 }, rotationDeg: 0 })
  pipes.push({
    id: 'fd-branch-1',
    system: 'sanitary',
    diameterMm: 50,
    slopePercent: 2,
    start: { xM: 3.6, yM: 1.0 },
    end: { xM: 4.4, yM: 1.8 },
    role: 'branch',
  })
  pipes.push(
    {
      id: 'wc-collector',
      system: 'sanitary',
      diameterMm: 110,
      slopePercent: 2,
      start: { xM: 0.6, yM: 1.8 },
      end: { xM: 7.9, yM: 1.8 },
      role: 'collector',
    },
    {
      id: 'basin-collector',
      system: 'sanitary',
      diameterMm: 63,
      slopePercent: 2,
      start: { xM: 0.8, yM: 0.6 },
      end: { xM: 7.9, yM: 0.6 },
      role: 'collector',
    },
    {
      id: 'basin-riser-leg',
      system: 'sanitary',
      diameterMm: 63,
      slopePercent: 2,
      start: { xM: 7.9, yM: 0.6 },
      end: { xM: 7.9, yM: 1.8 },
      role: 'branch',
    },
    {
      id: 'vent-run',
      system: 'vent',
      diameterMm: 75,
      slopePercent: null,
      start: { xM: 0.6, yM: 1.8 },
      end: { xM: -0.45, yM: 1.8 },
      role: 'branch',
    },
  )

  return {
    title: 'Storey 01 — sanitary plan',
    storeyLabel: '01',
    boundsM: { minXM: -0.9, minYM: -0.5, maxXM: 8.7, maxYM: 3.6 },
    structure,
    fixtures,
    risers: [
      {
        id: 'stack-1',
        system: 'sanitary',
        centre: { xM: 7.9, yM: 1.8 },
        diameterMm: 160,
        tag: '1.3ק',
        spansStoreyLabels: ['00', '01', '02', '03'],
      },
      {
        id: 'vent-stack-1',
        system: 'vent',
        centre: { xM: -0.45, yM: 1.8 },
        diameterMm: 75,
        tag: '1.4ק',
      },
    ],
    pipes,
    sleeves: [],
  }
}

/** One wall, one WC, one branch, one stack — small enough for a readable SVG snapshot. */
export function buildSyntheticMiniModel(): FloorDrawingModel {
  return {
    title: 'Storey 02 — sanitary plan',
    storeyLabel: '02',
    boundsM: { minXM: 0, minYM: 0, maxXM: 3, maxYM: 2 },
    structure: [{ kind: 'wall', outline: rect(0, 1.6, 3, 1.8) }],
    fixtures: [{ id: 'wc-1', kind: 'toilet', centre: { xM: 1, yM: 1.25 }, rotationDeg: 180 }],
    risers: [{ id: 'stack-1', system: 'sanitary', centre: { xM: 2.5, yM: 0.5 }, diameterMm: 110, tag: '2.1ק' }],
    pipes: [
      {
        id: 'run-1',
        system: 'sanitary',
        diameterMm: 110,
        slopePercent: 2,
        start: { xM: 1, yM: 1.25 },
        end: { xM: 2.5, yM: 0.5 },
        role: 'branch',
      },
    ],
    sleeves: [],
  }
}
