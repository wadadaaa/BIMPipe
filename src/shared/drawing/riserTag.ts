/**
 * Riser tag text for the sheet, in the reference drawing's convention
 * "<floor>.<stack>ק" — storey 01, stack 3 → "1.3ק". Pure functions; no client
 * data can enter: the only inputs are a storey label, an index, and an
 * optional engineer tag that is accepted only when it is a bare sheet number.
 */

/** Suffix letter of the sheet convention (Hebrew qof, "קו" = line/riser). */
export const RISER_TAG_SUFFIX = 'ק'

/**
 * Floor number from a storey label: the first run of digits, as an integer
 * ("01" → 1, "L04" → 4, "Storey 01" → 1, "קומה 2" → 2). Null when the label
 * carries no digits (e.g. "GF", "Sea Level") — the tag then omits the floor.
 */
export function parseFloorNumberFromStoreyLabel(label: string): number | null {
  const match = /\d+/.exec(label)
  if (match === null) return null
  const value = Number.parseInt(match[0], 10)
  return Number.isFinite(value) ? value : null
}

/** "<floor>.<index>ק", or "<index>ק" when the floor number is unknown. */
export function formatRiserTag(floorNumber: number | null, stackIndex: number): string {
  if (!Number.isInteger(stackIndex) || stackIndex < 1) {
    throw new Error(`stackIndex must be a positive integer, got ${stackIndex}`)
  }
  const body = floorNumber === null ? `${stackIndex}` : `${floorNumber}.${stackIndex}`
  return `${body}${RISER_TAG_SUFFIX}`
}

/**
 * Sheet-number pattern an engineer's own tag may take: a stack number
 * ("3") or floor.stack ("1.3"), each part at most two digits, optionally
 * already carrying the suffix. Anything else — free text, type names, the
 * 6–9 digit Revit element ids that Revit writes into `IfcElement.Tag` — is
 * rejected so no client string can reach the sheet.
 */
const ENGINEER_SHEET_TAG_PATTERN = new RegExp(`^(\\d{1,2})(?:\\.(\\d{1,2}))?${RISER_TAG_SUFFIX}?$`, 'u')

export interface NeutralisedEngineerTag {
  floorNumber: number | null
  stackIndex: number
}

/**
 * Accepts an engineer tag only when it is a bare sheet number; returns its
 * parts or null. Whitespace and bidi control marks are stripped first.
 */
export function neutraliseEngineerTagText(text: string | null | undefined): NeutralisedEngineerTag | null {
  if (text === null || text === undefined) return null
  const cleaned = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim()
  const match = ENGINEER_SHEET_TAG_PATTERN.exec(cleaned)
  if (match === null) return null
  const first = Number.parseInt(match[1], 10)
  const second = match[2] === undefined ? null : Number.parseInt(match[2], 10)
  if (second === null) return first >= 1 ? { floorNumber: null, stackIndex: first } : null
  return second >= 1 ? { floorNumber: first, stackIndex: second } : null
}

export interface ResolveRiserTagInput {
  /** Neutral storey label, e.g. "Storey 01"; the floor number is parsed from it. */
  storeyLabel: string
  /** 1-based stack index on the storey (deterministic ordering is the caller's job). */
  stackIndex: number
  /** Engineer tag texts to try, in preference order (e.g. `Tag`, then `Name`). */
  engineerTexts?: ReadonlyArray<string | null | undefined>
}

export interface ResolvedRiserTag {
  tag: string
  source: 'engineer-sheet-number' | 'formatted'
}

/**
 * Tag for one riser: a neutralised engineer sheet number when one exists on
 * the vertical segments (floor prefix taken from the storey label when the
 * engineer wrote only the stack number), otherwise the formatted
 * "<floor>.<index>ק".
 */
export function resolveRiserTag(input: ResolveRiserTagInput): ResolvedRiserTag {
  const floorNumber = parseFloorNumberFromStoreyLabel(input.storeyLabel)
  for (const text of input.engineerTexts ?? []) {
    const neutral = neutraliseEngineerTagText(text)
    if (neutral === null) continue
    return {
      tag: formatRiserTag(neutral.floorNumber ?? floorNumber, neutral.stackIndex),
      source: 'engineer-sheet-number',
    }
  }
  return { tag: formatRiserTag(floorNumber, input.stackIndex), source: 'formatted' }
}
