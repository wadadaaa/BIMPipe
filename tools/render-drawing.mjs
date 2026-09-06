#!/usr/bin/env node
/**
 * Render a FloorDrawingModel JSON to SVG (and optionally PNG) with the same
 * renderer the app uses (src/domain/drawing). TypeScript sources are loaded
 * through Vite's SSR module loader, so there is no build step and the `@/`
 * alias from vite.config.ts resolves.
 *
 *   node tools/render-drawing.mjs <model.json> <out.svg> [--png out.png]
 *        [--anonymize] [--scale 50|100] [--dpi N] [--no-underlay]
 *
 * `<model.json>` may also be `synthetic:toilet-block` or `synthetic:mini` to
 * render the built-in synthetic models from src/domain/drawing/syntheticFloorModels.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const positional = []
  const options = { png: null, anonymize: false, scale: 100, dpi: 220, showUnderlay: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--png') options.png = argv[++i]
    else if (arg === '--anonymize') options.anonymize = true
    else if (arg === '--no-underlay') options.showUnderlay = false
    else if (arg === '--scale') options.scale = Number(argv[++i])
    else if (arg === '--dpi') options.dpi = Number(argv[++i])
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`)
    else positional.push(arg)
  }
  if (positional.length !== 2) {
    throw new Error(
      'Usage: node tools/render-drawing.mjs <model.json|synthetic:toilet-block|synthetic:mini> <out.svg> [--png out.png] [--anonymize] [--scale 50|100] [--dpi N] [--no-underlay]',
    )
  }
  if (options.scale !== 50 && options.scale !== 100) throw new Error('--scale must be 50 or 100')
  if (!Number.isFinite(options.dpi) || options.dpi <= 0) throw new Error('--dpi must be a positive number')
  return { modelArg: positional[0], outSvg: positional[1], options }
}

async function loadModel(modelArg, synthetic) {
  if (modelArg === 'synthetic:toilet-block') return synthetic.buildSyntheticToiletBlockModel()
  if (modelArg === 'synthetic:mini') return synthetic.buildSyntheticMiniModel()
  return JSON.parse(await readFile(path.resolve(modelArg), 'utf8'))
}

async function main() {
  const { modelArg, outSvg, options } = parseArgs(process.argv.slice(2))
  const { createServer } = await import('vite')
  const server = await createServer({
    root: repoRoot,
    configFile: path.join(repoRoot, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const [renderer, raster, synthetic] = await Promise.all([
      server.ssrLoadModule('/src/domain/drawing/renderFloorDrawing.ts'),
      options.png ? server.ssrLoadModule('/src/domain/drawing/renderFloorDrawingPng.ts') : null,
      server.ssrLoadModule('/src/domain/drawing/syntheticFloorModels.ts'),
    ])
    const model = await loadModel(modelArg, synthetic)
    const renderOptions = {
      scale: options.scale,
      dpi: options.dpi,
      showUnderlay: options.showUnderlay,
      anonymize: options.anonymize,
    }
    const svg = renderer.renderFloorDrawingSvg(model, renderOptions)
    await mkdir(path.dirname(path.resolve(outSvg)), { recursive: true })
    await writeFile(path.resolve(outSvg), svg, 'utf8')
    console.log(`svg → ${outSvg} (${svg.length} bytes)`)
    if (options.png) {
      const png = raster.rasterizeSvgToPng(svg)
      await mkdir(path.dirname(path.resolve(options.png)), { recursive: true })
      await writeFile(path.resolve(options.png), png)
      console.log(`png → ${options.png} (${png.length} bytes)`)
    }
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
