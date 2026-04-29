import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { IfcAPI } from 'web-ifc'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const labRoot = resolve(here, '..')

const inputMappingPath = '/Users/wadadaaa/Downloads/ADAM_10-2-full-riser-mapping (1).json'
const preferredSourcePath = '/Users/wadadaaa/Downloads/ADAM_10.ifc'
const fallbackSourcePath = '/Users/wadadaaa/Downloads/ADAM_10-passthrough.ifc'
const outputIfcPath = resolve(labRoot, 'output', 'ADAM_10-2-full-no180-ifc2x3.ifc')
const outputMappingPath = resolve(labRoot, 'output', 'ADAM_10-2-full-no180-riser-mapping.json')

const targetStoreyName = 'קומה 2'
const targetRiserTags = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'])
const epsilon = 1e-6

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})

async function main() {
  const inputMapping = readJson(inputMappingPath)
  const sourcePath = resolveSourcePath()
  const sourceBytes = new Uint8Array(readFileSync(sourcePath))
  assertSourceHasNoBimpipeArtifacts(sourceBytes, sourcePath)
  const sourceStoreyRecords = readSourceStoreyRecords(inputMapping)
  const sourceStoreyId = sourceStoreyRecords[0].storeyEntityId
  const storeys = readStoreys(inputMapping)

  const server = await createSsrServer()
  const api = new IfcAPI()
  await api.Init(undefined, true)

  try {
    const { buildRiserStack } = await server.ssrLoadModule('/src/shared/routes/buildRiserStacks.ts')
    const { exportFullIfcWithRisersWithDebug } = await server.ssrLoadModule(
      '/src/shared/ifc/exportFullIfcWithRisers.ts',
    )
    const risers = buildRisersFromSourceRecords(buildRiserStack, storeys, sourceStoreyId, sourceStoreyRecords)
    const result = await exportFullIfcWithRisersWithDebug(
      api,
      sourceBytes,
      sourceStoreyId,
      risers,
      inputMapping.sourceFloorPlanBounds ?? null,
      {
        exportRunId: 'adam10-no-180',
        timestamp: new Date().toISOString(),
        sourceIfcName: basename(sourcePath),
        storeys,
      },
    )

    mkdirSync(dirname(outputIfcPath), { recursive: true })
    writeFileSync(outputIfcPath, Buffer.from(result.ifcBytes))
    writeJson(outputMappingPath, result.debugMapping)

    const rows = buildVerificationRows(inputMapping, result.debugMapping)
    assertVerificationRows(rows)
    printVerificationRows(rows)
    console.log(`ifc=${outputIfcPath}`)
    console.log(`mapping=${outputMappingPath}`)
  } finally {
    api.Dispose()
    await server.close()
  }
}

function resolveSourcePath() {
  if (existsSync(preferredSourcePath)) return preferredSourcePath
  if (existsSync(fallbackSourcePath)) {
    console.error(`Preferred source missing: ${preferredSourcePath}`)
    console.error(`Falling back to: ${fallbackSourcePath}`)
    return fallbackSourcePath
  }
  throw new Error(`Missing source IFC. Checked ${preferredSourcePath} and ${fallbackSourcePath}.`)
}

function assertSourceHasNoBimpipeArtifacts(sourceBytes, sourcePath) {
  if (Buffer.from(sourceBytes).indexOf('BIMPipe') !== -1) {
    throw new Error(
      `Source IFC ${sourcePath} already contains BIMPipe elements; ` +
      'refusing to export to avoid duplicates. Use a clean pass-through.',
    )
  }
}

async function createSsrServer() {
  const silentLogger = {
    hasErrorLogged() { return false },
    error() {},
    warn() {},
    info() {},
    warnOnce() {},
    clearScreen() {},
  }

  return createServer({
    root: repoRoot,
    appType: 'custom',
    logLevel: 'silent',
    customLogger: silentLogger,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  })
}

function buildRisersFromSourceRecords(buildRiserStack, storeys, sourceStoreyId, sourceStoreyRecords) {
  return sourceStoreyRecords.flatMap((record) => {
    let nextId = 0
    return buildRiserStack(
      storeys,
      sourceStoreyId,
      record.webPositionRaw,
      record.riserTag,
      () => `${record.riserTag.toLowerCase()}-${nextId++}`,
    )
  })
}

function readSourceStoreyRecords(mapping) {
  const records = mapping.risers
    .filter((riser) => targetRiserTags.has(riser.riserTag) && riser.storeyName === targetStoreyName)
    .sort((left, right) => left.riserTag.localeCompare(right.riserTag, undefined, { numeric: true }))

  if (records.length !== targetRiserTags.size) {
    throw new Error(`Expected ${targetRiserTags.size} ${targetStoreyName} risers, got ${records.length}.`)
  }

  return records
}

function readStoreys(mapping) {
  const storeysById = new Map()
  for (const record of mapping.risers) {
    if (storeysById.has(record.storeyEntityId)) continue
    storeysById.set(record.storeyEntityId, {
      id: record.storeyEntityId,
      name: record.storeyName,
      elevation: record.storeyElevation,
      modelId: 'adam10-no-180',
    })
  }
  return [...storeysById.values()]
}

function buildVerificationRows(oldMapping, newMapping) {
  const oldByTag = new Map(
    readSourceStoreyRecords(oldMapping).map((record) => [record.riserTag, record]),
  )
  return newMapping.risers
    .filter((riser) => targetRiserTags.has(riser.riserTag))
    .sort((left, right) => left.riserTag.localeCompare(right.riserTag, undefined, { numeric: true }))
    .map((record) => {
      const oldRecord = oldByTag.get(record.riserTag)
      if (!oldRecord) throw new Error(`Missing old record for ${record.riserTag}.`)
      return {
        riserTag: record.riserTag,
        rawX: record.webPositionRaw.x,
        rawZ: record.webPositionRaw.z,
        usedX: record.webPositionUsedForExport.x,
        usedZ: record.webPositionUsedForExport.z,
        localX: record.finalIfcLocalPlacement.x,
        localY: record.finalIfcLocalPlacement.y,
        oldLocalX: oldRecord.finalIfcLocalPlacement.x,
        oldLocalY: oldRecord.finalIfcLocalPlacement.y,
      }
    })
}

function assertVerificationRows(rows) {
  if (rows.length !== targetRiserTags.size) {
    throw new Error(`Expected ${targetRiserTags.size} verification rows, got ${rows.length}.`)
  }

  for (const row of rows) {
    if (!sameNumber(row.usedX, row.rawX) || !sameNumber(row.usedZ, row.rawZ)) {
      throw new Error(
        `${row.riserTag} used/raw mismatch: raw=(${row.rawX}, ${row.rawZ}) used=(${row.usedX}, ${row.usedZ})`,
      )
    }
    if (sameNumber(row.localX, row.oldLocalX) && sameNumber(row.localY, row.oldLocalY)) {
      throw new Error(`${row.riserTag} local placement did not change from old mapping.`)
    }
  }
}

function printVerificationRows(rows) {
  console.log('riserTag | rawX | rawZ | usedX | usedZ | localX | localY')
  for (const row of rows) {
    console.log([
      row.riserTag,
      formatNumber(row.rawX),
      formatNumber(row.rawZ),
      formatNumber(row.usedX),
      formatNumber(row.usedZ),
      formatNumber(row.localX),
      formatNumber(row.localY),
    ].join(' | '))
  }
}

function sameNumber(left, right) {
  return Math.abs(left - right) <= epsilon
}

function formatNumber(value) {
  return Number(value).toFixed(6)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
