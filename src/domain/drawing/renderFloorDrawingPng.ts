/**
 * Node-only raster path for the drawing renderer (tests, the CLI under
 * `tools/`, the gauntlet critic loop). Never import this from app code: it
 * pulls in the native `@resvg/resvg-js` devDependency. The browser feature
 * only needs `renderFloorDrawingSvg`.
 */
import { Resvg } from '@resvg/resvg-js'
import type { FloorDrawingModel } from './floorDrawingModel'
import { renderFloorDrawingSvg, type RenderFloorDrawingOptions } from './renderFloorDrawing'

export interface RasterizeOptions {
  /** Font family used when the SVG's family is not installed. */
  readonly defaultFontFamily?: string
}

export function renderFloorDrawingPng(
  model: FloorDrawingModel,
  options: RenderFloorDrawingOptions,
  raster: RasterizeOptions = {},
): Uint8Array {
  return rasterizeSvgToPng(renderFloorDrawingSvg(model, options), raster)
}

export function rasterizeSvgToPng(svg: string, raster: RasterizeOptions = {}): Uint8Array {
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true,
      defaultFontFamily: raster.defaultFontFamily ?? 'Arial',
    },
    // The SVG carries width/height in px already; render at 1:1.
    fitTo: { mode: 'original' },
  })
  return resvg.render().asPng()
}
