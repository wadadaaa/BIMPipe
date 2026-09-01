import { describe, it, expect } from 'vitest'
import { toMeters, toMm, formatLengthM, formatLengthMm } from './lengthUnits'

describe('toMeters', () => {
  it('converts millimetres to metres', () => {
    expect(toMeters(3000, 'mm')).toBeCloseTo(3, 10)
  })

  it('converts centimetres to metres', () => {
    expect(toMeters(3015, 'cm')).toBeCloseTo(30.15, 10)
  })

  it('passes metres through unchanged', () => {
    expect(toMeters(2.5, 'm')).toBe(2.5)
  })

  it('preserves sign', () => {
    expect(toMeters(-220, 'm')).toBe(-220)
    expect(toMeters(-500, 'mm')).toBeCloseTo(-0.5, 10)
  })
})

describe('toMm', () => {
  it('converts metres to millimetres', () => {
    expect(toMm(0.15, 'm')).toBeCloseTo(150, 10)
  })

  it('converts centimetres to millimetres', () => {
    expect(toMm(50, 'cm')).toBe(500)
  })

  it('passes millimetres through unchanged', () => {
    expect(toMm(150, 'mm')).toBe(150)
  })
})

describe('formatLengthM', () => {
  it('formats the 096 cm storey elevation as 30.15 m', () => {
    expect(formatLengthM(3015, 'cm')).toBe('30.15 m')
  })

  it('absorbs floating-point noise from real IFC attribute values', () => {
    // Actual value found in a cm-based Revit 2026 export.
    expect(formatLengthM(3015.0000000000018, 'cm')).toBe('30.15 m')
  })

  it('formats mm values as metres', () => {
    expect(formatLengthM(3000, 'mm')).toBe('3.00 m')
  })

  it('formats metre values with two decimals by default', () => {
    expect(formatLengthM(125, 'm')).toBe('125.00 m')
  })

  it('keeps negative signs', () => {
    expect(formatLengthM(-220, 'm')).toBe('-220.00 m')
  })

  it('never renders negative zero', () => {
    expect(formatLengthM(-0.0001, 'm')).toBe('0.00 m')
    expect(formatLengthM(-0, 'm')).toBe('0.00 m')
  })

  it('honours the decimals option', () => {
    expect(formatLengthM(125, 'm', { decimals: 1 })).toBe('125.0 m')
    expect(formatLengthM(3015, 'cm', { decimals: 3 })).toBe('30.150 m')
  })
})

describe('formatLengthMm', () => {
  it('formats metre drops as millimetres', () => {
    expect(formatLengthMm(0.15, 'm')).toBe('150 mm')
  })

  it('passes millimetre values through', () => {
    expect(formatLengthMm(500, 'mm')).toBe('500 mm')
  })

  it('rounds to whole millimetres by default', () => {
    expect(formatLengthMm(0.0503, 'm')).toBe('50 mm')
  })

  it('never renders negative zero', () => {
    expect(formatLengthMm(-0.0001, 'm')).toBe('0 mm')
  })

  it('honours the decimals option', () => {
    expect(formatLengthMm(0.1234, 'm', { decimals: 1 })).toBe('123.4 mm')
  })
})
