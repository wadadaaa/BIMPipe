/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatStoreyElevationChip } from './FloorViewer'

describe('FloorViewer status bar elevation chip', () => {
  it('formats the raw IFC elevation as metres using the declared model unit', () => {
    // 096-style cm model: storey "01" stores Elevation 3015 (= 30.15 m).
    expect(formatStoreyElevationChip(3015, 'cm')).toBe('30.15 m')
    // Duplex-style mm model.
    expect(formatStoreyElevationChip(3000, 'mm')).toBe('3.00 m')
    expect(formatStoreyElevationChip(0, 'm')).toBe('0.00 m')
  })

  it('shows the raw number with no unit suffix when the model declares no supported unit', () => {
    expect(formatStoreyElevationChip(612.4, null)).toBe('612')
    expect(formatStoreyElevationChip(612.4, null)).not.toContain('mm')
  })

  it('never renders a hardcoded mm suffix for the elevation chip', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    expect(component).not.toMatch(/selectedStoreyElevation\).toLocaleString\(\)\} mm/)
    expect(component).toContain('formatStoreyElevationChip(selectedStoreyElevation, modelLengthUnit)')
  })
})

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

  it('keeps a neutral before-after sanitary demo surface in the viewer', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    const stylesheet = readFileSync('src/viewer/FloorViewer.css', 'utf8')

    expect(component).toContain('floor-viewer__sanitary-compare')
    expect(component).toContain('Route demo view')
    expect(component).toContain('Detected fixture inputs and selected risers. Generated routes are hidden for comparison.')
    expect(component).toContain('Generated sanitary routes are shown with pipe diameters and slope design.')
    expect(component).toContain('Before')
    expect(component).toContain('After')
    expect(component).toContain('routeFactCards')
    expect(component).toContain('No route breakdown available yet.')
    expect(component).toContain('slopeIntentLabel')
    expect(component).toContain('routeSegmentCountLabel')
    expect(stylesheet).toContain('.floor-viewer__sanitary-compare')
    expect(stylesheet).toContain('.floor-viewer__sanitary-toggle')
  })

  it('does not contain investor-facing product copy', () => {
    const productSources = [
      readFileSync('src/viewer/FloorViewer.tsx', 'utf8'),
      readFileSync('src/features/sidebar/RisersPanel.tsx', 'utf8'),
    ].join('\n')

    expect(productSources).not.toMatch(/investor/i)
  })
})
