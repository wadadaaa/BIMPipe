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

  it('keeps DEMO-only flow animation controls and visual layer isolated to the viewer', () => {
    const component = readFileSync('src/viewer/FloorViewer.tsx', 'utf8')
    const stylesheet = readFileSync('src/viewer/FloorViewer.css', 'utf8')

    expect(component).toContain('buildSanitaryFlowStreams')
    expect(component).toContain('Play Flow')
    expect(component).toContain('Pause Flow')
    expect(component).toContain('Replay Flow')
    expect(component).toContain('floor-viewer__flow-overlay')
    expect(component).toContain('floor-viewer__flow-stream')
    expect(component).toContain('floor-viewer__flow-node')
    expect(component).toContain('floor-viewer__flow-card')
    expect(component).toContain("theme === 'dark'")
    expect(component).toContain('serviceMapThemeEnabled ?')
    expect(component).toContain('buildServiceMapFlowPath')
    expect(component).toContain("['rail', 'halo', 'core', 'pulse']")
    expect(component).toContain('flowAnimationState')
    expect(stylesheet).toContain('.floor-viewer__flow-overlay')
    expect(stylesheet).toContain('.floor-viewer__flow-stream')
    expect(stylesheet).toContain('.floor-viewer__flow-stream--rail')
    expect(stylesheet).toContain('.floor-viewer__flow-node')
    expect(stylesheet).toContain('.floor-viewer__flow-card')
    expect(stylesheet).toContain('@keyframes sanitary-flow-stream')
  })

  it('does not contain investor-facing product copy', () => {
    const productSources = [
      readFileSync('src/viewer/FloorViewer.tsx', 'utf8'),
      readFileSync('src/features/sidebar/RisersPanel.tsx', 'utf8'),
    ].join('\n')

    expect(productSources).not.toMatch(/investor/i)
  })
})
