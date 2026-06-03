/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('FloorViewer route label styles', () => {
  it('only returns route label modifier classes that are defined in CSS', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    const stylesheet = readFileSync('src/viewer/FloorViewer.css', 'utf8')
    const returnedRouteLabelClasses = Array.from(
      component.matchAll(/['"](floor-viewer__route-label--[a-z-]+)['"]/g),
      ([, className]) => className,
    )

    expect(returnedRouteLabelClasses).not.toHaveLength(0)
    for (const className of returnedRouteLabelClasses) {
      expect(stylesheet, `${className} should be defined in FloorViewer.css`).toContain(`.${className}`)
    }
  })
})
