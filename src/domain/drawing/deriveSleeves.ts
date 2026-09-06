import type {
  DrawingPipeRun,
  DrawingPointM,
  DrawingPolygonM,
  DrawingSleeve,
  DrawingStructureElement,
} from './floorDrawingModel'

/**
 * Derives wall sleeves from pipe runs crossing wall outlines: every place a
 * run enters a wall polygon on one side and leaves it on the other becomes a
 * sleeve centred on the crossing, oriented along the run, with `lengthM` set
 * to the wall thickness actually traversed.
 *
 * Runs that start or end inside a wall (a stub into a stack chase, a fixture
 * connection behind a wall line) are not crossings and produce nothing.
 * Pure and deterministic: output order follows pipe id, then wall index, then
 * position along the run.
 */
export function deriveSleeves(
  pipes: readonly DrawingPipeRun[],
  structure: readonly DrawingStructureElement[],
): DrawingSleeve[] {
  const walls = structure
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.kind === 'wall' && element.outline.length >= 3)
  if (walls.length === 0) return []

  const sleeves: DrawingSleeve[] = []
  const sortedPipes = [...pipes].sort((a, b) => a.id.localeCompare(b.id))

  for (const pipe of sortedPipes) {
    const dx = pipe.end.xM - pipe.start.xM
    const dy = pipe.end.yM - pipe.start.yM
    const lengthM = Math.hypot(dx, dy)
    if (lengthM < 1e-9) continue
    const directionDeg = normaliseDeg((Math.atan2(dy, dx) * 180) / Math.PI)

    for (const { element, index } of walls) {
      const crossings = segmentPolygonCrossings(pipe.start, pipe.end, element.outline)
      crossings.forEach((crossing, k) => {
        const tMid = (crossing.tIn + crossing.tOut) / 2
        sleeves.push({
          id: `sleeve|${pipe.id}|${index}|${k}`,
          at: { xM: pipe.start.xM + dx * tMid, yM: pipe.start.yM + dy * tMid },
          directionDeg,
          pipeDiameterMm: pipe.diameterMm,
          lengthM: (crossing.tOut - crossing.tIn) * lengthM,
        })
      })
    }
  }
  return sleeves
}

interface Crossing {
  readonly tIn: number
  readonly tOut: number
}

const T_EPSILON = 1e-9

/**
 * Parameters along the open segment where it fully traverses the polygon.
 * Intersections at the segment ends (t ≈ 0 or t ≈ 1) do not count as a
 * traversal, so a run ending on a wall face yields no crossing.
 */
export function segmentPolygonCrossings(
  start: DrawingPointM,
  end: DrawingPointM,
  polygon: DrawingPolygonM,
): Crossing[] {
  const ts: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const t = segmentSegmentParameter(start, end, a, b)
    if (t !== null) ts.push(t)
  }
  ts.sort((x, y) => x - y)
  const unique: number[] = []
  for (const t of ts) {
    if (unique.length === 0 || t - unique[unique.length - 1] > T_EPSILON) unique.push(t)
  }

  const startInside = pointInPolygon(start, polygon)
  const crossings: Crossing[] = []
  // Walking along the run, each intersection toggles inside/outside.
  let inside = startInside
  let tIn: number | null = null
  for (const t of unique) {
    if (!inside) {
      tIn = t
    } else if (tIn !== null && t - tIn > T_EPSILON) {
      crossings.push({ tIn, tOut: t })
      tIn = null
    } else {
      tIn = null
    }
    inside = !inside
  }
  return crossings.filter(
    (c) => c.tIn > T_EPSILON && c.tOut < 1 - T_EPSILON && c.tOut - c.tIn > T_EPSILON,
  )
}

/** Parameter t on p→q where it meets segment a→b; null when parallel or disjoint. */
function segmentSegmentParameter(
  p: DrawingPointM,
  q: DrawingPointM,
  a: DrawingPointM,
  b: DrawingPointM,
): number | null {
  const rX = q.xM - p.xM
  const rY = q.yM - p.yM
  const sX = b.xM - a.xM
  const sY = b.yM - a.yM
  const denom = rX * sY - rY * sX
  if (Math.abs(denom) < 1e-12) return null
  const apX = a.xM - p.xM
  const apY = a.yM - p.yM
  const t = (apX * sY - apY * sX) / denom
  const u = (apX * rY - apY * rX) / denom
  if (t < -T_EPSILON || t > 1 + T_EPSILON || u < -T_EPSILON || u > 1 + T_EPSILON) return null
  return Math.min(1, Math.max(0, t))
}

/** Even–odd rule; points on the boundary are treated as outside. */
export function pointInPolygon(point: DrawingPointM, polygon: DrawingPolygonM): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const crossesRay =
      a.yM > point.yM !== b.yM > point.yM &&
      point.xM < ((b.xM - a.xM) * (point.yM - a.yM)) / (b.yM - a.yM) + a.xM
    if (crossesRay) inside = !inside
  }
  return inside
}

function normaliseDeg(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360
  return wrapped + 0
}
