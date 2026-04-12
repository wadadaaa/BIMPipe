export interface Point3D {
  x: number
  y: number
  z: number
}

/**
 * The viewer uses Y as the vertical axis, so plan distance is measured on X/Z.
 */
export function planDistance(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

export function averagePosition(points: Point3D[]): Point3D {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  }
}

export function detectPlanUnits(points: Point3D[]): 'mm' | 'm' {
  for (const point of points) {
    if (Math.abs(point.x) > 1000 || Math.abs(point.z) > 1000) return 'mm'
  }
  return 'm'
}
