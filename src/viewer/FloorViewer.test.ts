/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('FloorViewer sanitary route presentation styles', () => {
  it('only returns route label and line modifier classes that are defined in CSS', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    const stylesheet = readFileSync('src/viewer/FloorViewer.css', 'utf8')
    const returnedRouteClasses = Array.from(
      component.matchAll(/['"](floor-viewer__route-(?:label|line)--[a-z-]+)['"]/g),
      ([, className]) => className,
    )

    expect(returnedRouteClasses).not.toHaveLength(0)
    for (const className of returnedRouteClasses) {
      expect(stylesheet, `${className} should be defined in FloorViewer.css`).toContain(`.${className}`)
    }
  })

  it('keeps an investor-readable before-after sanitary comparison surface in the viewer', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    const stylesheet = readFileSync('src/viewer/FloorViewer.css', 'utf8')

    expect(component).toContain('floor-viewer__sanitary-compare')
    expect(component).toContain('Before')
    expect(component).toContain('After')
    expect(component).toContain('110 mm toilet')
    expect(component).toContain('63 mm main line')
    expect(component).toContain('50 mm branch')
    expect(component).toContain('2.0% slope toward riser')
    expect(stylesheet).toContain('.floor-viewer__sanitary-compare')
    expect(stylesheet).toContain('.floor-viewer__sanitary-toggle')
  })
})
