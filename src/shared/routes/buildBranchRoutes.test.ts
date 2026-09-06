import { describe, expect, it } from 'vitest'
import type { FixtureRiserAssignment } from '@/domain/assignFixturesToRisers'
import { buildBranchRoutesFromAssignments } from './buildBranchRoutes'

const bathAssignment: FixtureRiserAssignment = {
  fixtureExpressId: 13,
  kind: 'BATH',
  storeyId: 2,
  unassigned: false,
  riserId: 'riser-a',
  stackId: 'stack-a',
  fixturePosition: { x: 800, y: 612, z: 800 },
  riserPosition: { x: 1000, y: 612, z: 950 },
  planDistance: 250,
  units: 'mm',
  assignedBy: 'nearest',
  exceedsMaxBranchLength: false,
}

const unassignedToilet: FixtureRiserAssignment = {
  fixtureExpressId: 14,
  kind: 'TOILETPAN',
  storeyId: 2,
  unassigned: true,
  fixturePosition: { x: 5000, y: 612, z: 5000 },
  reason: 'no-riser-within-branch-length',
}

describe('buildBranchRoutesFromAssignments', () => {
  it('returns no floors when there are no assigned entries', () => {
    expect(buildBranchRoutesFromAssignments([])).toEqual([])
    expect(buildBranchRoutesFromAssignments([unassignedToilet])).toEqual([])
  })

  it('routes assigned fixtures and skips unassigned ones', () => {
    const floors = buildBranchRoutesFromAssignments([bathAssignment, unassignedToilet])

    expect(floors).toHaveLength(1)
    expect(floors[0].storeyId).toBe(2)
    // L-run, X leg first: (800,800) -> (1000,800) -> (1000,950).
    expect(floors[0].segments).toHaveLength(2)
    expect(floors[0].segments.map((segment) => segment.axis)).toEqual(['x', 'z'])
    for (const segment of floors[0].segments) {
      expect(segment.servedFixtureExpressIds).toEqual([13])
      expect(segment.riserId).toBe('riser-a')
      expect(segment.riserStackId).toBe('stack-a')
    }
  })

  it('passes the assignment plan units through instead of re-detecting them', () => {
    // Coordinates are all below the mm-detection threshold, so a magnitude
    // re-detection would say metres; the explicit assignment units must win.
    const floors = buildBranchRoutesFromAssignments([
      {
        ...bathAssignment,
        fixturePosition: { x: 8, y: 6, z: 8 },
        riserPosition: { x: 10, y: 6, z: 9 },
        units: 'mm',
      },
    ])

    expect(floors[0].planUnits).toBe('mm')
  })

  it('maps fixture and riser plan coordinates from the X/Z axes of 3D positions', () => {
    const floors = buildBranchRoutesFromAssignments([bathAssignment])
    const [xLeg, zLeg] = floors[0].segments

    expect(xLeg.start).toMatchObject({ x: 800, z: 800 })
    expect(xLeg.end).toMatchObject({ x: 1000, z: 800 })
    expect(zLeg.start).toMatchObject({ x: 1000, z: 800 })
    expect(zLeg.end).toMatchObject({ x: 1000, z: 950 })
    // Riser end is the datum (0); upstream ends rise at 2% of remaining run.
    expect(zLeg.end.elevation).toBe(0)
    expect(xLeg.start.elevation).toBeCloseTo((200 + 150) * 0.02)
  })
})
