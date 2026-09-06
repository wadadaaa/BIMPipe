import { describe, expect, it } from 'vitest'
import {
  formatRiserTag,
  neutraliseEngineerTagText,
  parseFloorNumberFromStoreyLabel,
  resolveRiserTag,
  RISER_TAG_SUFFIX,
} from './riserTag'

describe('parseFloorNumberFromStoreyLabel', () => {
  it('takes the first run of digits as an integer', () => {
    expect(parseFloorNumberFromStoreyLabel('01')).toBe(1)
    expect(parseFloorNumberFromStoreyLabel('L04')).toBe(4)
    expect(parseFloorNumberFromStoreyLabel('Storey 01')).toBe(1)
    expect(parseFloorNumberFromStoreyLabel('קומה 2')).toBe(2)
    expect(parseFloorNumberFromStoreyLabel('Level 12 (roof)')).toBe(12)
  })

  it('is null when the label carries no digits', () => {
    expect(parseFloorNumberFromStoreyLabel('GF')).toBeNull()
    expect(parseFloorNumberFromStoreyLabel('')).toBeNull()
  })
})

describe('formatRiserTag', () => {
  it('formats "<floor>.<stack>ק" — storey 01, stack 3 → "1.3ק"', () => {
    expect(formatRiserTag(1, 3)).toBe(`1.3${RISER_TAG_SUFFIX}`)
    expect(formatRiserTag(1, 3)).toBe('1.3ק')
    expect(formatRiserTag(4, 12)).toBe('4.12ק')
  })

  it('omits the floor when unknown', () => {
    expect(formatRiserTag(null, 2)).toBe('2ק')
  })

  it('rejects non-positive or fractional stack indices', () => {
    expect(() => formatRiserTag(1, 0)).toThrow()
    expect(() => formatRiserTag(1, 1.5)).toThrow()
  })
})

describe('neutraliseEngineerTagText', () => {
  it('accepts bare sheet numbers, with or without the suffix', () => {
    expect(neutraliseEngineerTagText('3')).toEqual({ floorNumber: null, stackIndex: 3 })
    expect(neutraliseEngineerTagText('1.3')).toEqual({ floorNumber: 1, stackIndex: 3 })
    expect(neutraliseEngineerTagText('1.3ק')).toEqual({ floorNumber: 1, stackIndex: 3 })
    expect(neutraliseEngineerTagText(' \u200f12.4 ')).toEqual({ floorNumber: 12, stackIndex: 4 })
  })

  it('rejects free text, type names and Revit element ids', () => {
    expect(neutraliseEngineerTagText('Pipe Types:PVC 110 - 8828274')).toBeNull()
    expect(neutraliseEngineerTagText('8828274')).toBeNull()
    expect(neutraliseEngineerTagText('123')).toBeNull()
    expect(neutraliseEngineerTagText('R3')).toBeNull()
    expect(neutraliseEngineerTagText('1.0')).toBeNull()
    expect(neutraliseEngineerTagText('0')).toBeNull()
    expect(neutraliseEngineerTagText('')).toBeNull()
    expect(neutraliseEngineerTagText(null)).toBeNull()
    expect(neutraliseEngineerTagText(undefined)).toBeNull()
  })
})

describe('resolveRiserTag', () => {
  it('falls back to the formatted tag from the storey label and index', () => {
    expect(resolveRiserTag({ storeyLabel: 'Storey 01', stackIndex: 3 })).toEqual({ tag: '1.3ק', source: 'formatted' })
    expect(resolveRiserTag({ storeyLabel: 'GF', stackIndex: 3 })).toEqual({ tag: '3ק', source: 'formatted' })
  })

  it('prefers a neutralised engineer sheet number and fills the floor from the storey label', () => {
    expect(resolveRiserTag({ storeyLabel: 'Storey 04', stackIndex: 9, engineerTexts: ['7'] })).toEqual({
      tag: '4.7ק',
      source: 'engineer-sheet-number',
    })
    expect(resolveRiserTag({ storeyLabel: 'Storey 04', stackIndex: 9, engineerTexts: ['2.7'] })).toEqual({
      tag: '2.7ק',
      source: 'engineer-sheet-number',
    })
  })

  it('never lets a free-text or element-id tag through', () => {
    const resolved = resolveRiserTag({
      storeyLabel: 'Storey 01',
      stackIndex: 2,
      engineerTexts: ['8828274', 'Pipe Types:PVC 110 - 8828274', null, undefined],
    })
    expect(resolved).toEqual({ tag: '1.2ק', source: 'formatted' })
  })
})
