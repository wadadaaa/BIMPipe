import { describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { readRepresentationContextFrame } from './readRepresentationContextFrame'
import { resolveModelOriginDecision } from './resolveModelOrigin'
import { resolveModelLengthUnit } from './resolveModelLengthUnit'
import {
  buildContextWcsIfc,
  CONTEXT_FIXTURE_TRUE_NORTH_DEG,
  CONTEXT_FIXTURE_WCS_CM,
} from './contextWcsFixture.testutil'

async function openFixture(text: string): Promise<{ api: IfcAPI; modelId: number }> {
  const ifc = await import('web-ifc')
  const api = new ifc.IfcAPI()
  await api.Init()
  const modelId = api.OpenModel(new TextEncoder().encode(text))
  return { api, modelId }
}

describe('readRepresentationContextFrame', () => {
  it('reads the 3D Model context WCS and TrueNorth in model units and metres', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc())
    try {
      const frame = await readRepresentationContextFrame(api, modelId, 'cm')
      expect(frame).not.toBeNull()
      // The parent context, never one of the sub-contexts (#24/#25).
      expect(frame!.contextExpressId).toBe(23)
      expect(frame!.lengthUnit).toBe('cm')
      expect(frame!.wcsLocationSource.x).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.x, 6)
      expect(frame!.wcsLocationSource.y).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.y, 6)
      expect(frame!.wcsLocationSource.z).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.z, 6)
      // Metres via the single converter (cm -> m).
      expect(frame!.wcsLocationM!.x).toBeCloseTo(196_714.72399833947, 6)
      expect(frame!.wcsLocationM!.y).toBeCloseTo(743_288.86584343016, 6)
      expect(frame!.wcsLocationM!.z).toBeCloseTo(12.5, 9)
      expect(frame!.trueNorthDeg).toBeCloseTo(CONTEXT_FIXTURE_TRUE_NORTH_DEG, 9)
      expect(frame!.wcsRotationDeg).toBe(0)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('resolves the unit itself when the caller does not pass one', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc())
    try {
      const frame = await readRepresentationContextFrame(api, modelId)
      expect(frame!.lengthUnit).toBe('cm')
      expect(frame!.wcsLocationM!.z).toBeCloseTo(12.5, 9)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('reports an absent TrueNorth as null and a RefDirection as a WCS rotation', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc({ trueNorthDeg: null, rotateWcs: true }))
    try {
      const frame = await readRepresentationContextFrame(api, modelId, 'cm')
      expect(frame!.trueNorthDeg).toBeNull()
      expect(frame!.wcsRotationDeg).toBeCloseTo(90, 9)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('reads an identity WCS as zero with no far verdict downstream', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc({ wcsCm: { x: 0, y: 0, z: 0 }, trueNorthDeg: null }))
    try {
      const frame = await readRepresentationContextFrame(api, modelId, 'cm')
      expect(frame!.wcsLocationSource).toEqual({ x: 0, y: 0, z: 0 })
      expect(frame!.wcsLocationM).toEqual({ x: 0, y: 0, z: 0 })
      expect(frame!.trueNorthDeg).toBeNull()
    } finally {
      api.CloseModel(modelId)
    }
  })
})

describe('resolveModelOriginDecision with a far context WCS', () => {
  // Near-origin storey bounds (viewer metres): geometry web-ifc produced
  // without applying the context WCS, exactly the SHBJ-style situation.
  const nearOriginBounds = { minX: -12, maxX: 14, minZ: -9, maxZ: 10 }

  it('keeps the identity render origin and reports detectedBy context with the source frame', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc())
    try {
      const unit = await resolveModelLengthUnit(api, modelId)
      const decision = await resolveModelOriginDecision(api, modelId, nearOriginBounds, unit)
      expect(decision).not.toBeNull()
      // The viewer must not move the model: render origin stays identity.
      expect(decision!.origin).toEqual({ x: 0, y: 0, z: 0 })
      expect(decision!.detectedBy).toBe('context')
      expect(decision!.sourceFrame).toMatchObject({
        detectedBy: 'context',
        lengthUnit: 'cm',
        wcsRotationDeg: 0,
      })
      expect(decision!.sourceFrame!.offsetSourceUnits.x).toBeCloseTo(CONTEXT_FIXTURE_WCS_CM.x, 6)
      expect(decision!.sourceFrame!.offsetM!.x).toBeCloseTo(196_714.72399833947, 6)
      expect(decision!.sourceFrame!.offsetM!.y).toBeCloseTo(743_288.86584343016, 6)
      expect(decision!.sourceFrame!.offsetM!.z).toBeCloseTo(12.5, 9)
      expect(decision!.sourceFrame!.trueNorthDeg).toBeCloseTo(6.53, 9)
    } finally {
      api.CloseModel(modelId)
    }
  })

  it('still reports none for an identity context WCS (no sourceFrame key)', async () => {
    const { api, modelId } = await openFixture(buildContextWcsIfc({ wcsCm: { x: 0, y: 0, z: 0 }, trueNorthDeg: null }))
    try {
      const decision = await resolveModelOriginDecision(api, modelId, nearOriginBounds, 'cm')
      expect(decision).toEqual({ origin: { x: 0, y: 0, z: 0 }, detectedBy: 'none' })
      expect('sourceFrame' in decision!).toBe(false)
    } finally {
      api.CloseModel(modelId)
    }
  })
})
