import { z } from 'zod'

export const demoConfigSchema = z.object({
  name: z.string().min(1),
  model: z.object({
    fileName: z.string().min(1),
    schema: z.string().min(1),
    source: z.string().min(1),
    assetPath: z.string().min(1),
  }),
  scope: z.object({
    includedFloors: z.array(z.string().min(1)).min(1),
    excludedFloors: z.array(z.string().min(1)).default([]),
  }),
  routing: z.object({
    mode: z.string().min(1),
    allowManualRiserSelection: z.boolean(),
  }),
})

export type DemoConfig = z.infer<typeof demoConfigSchema>

declare const __BIMPIPE_DEMO_CONFIG__: unknown

export type DemoRuntimeConfig = { enabled: false } | { enabled: true; config: DemoConfig }

export function getDemoRuntimeConfig(): DemoRuntimeConfig {
  if (import.meta.env.DEMO_MODE !== true) return { enabled: false }

  return parseDemoRuntimeConfig(__BIMPIPE_DEMO_CONFIG__)
}

export function buildDemoModeUploadError(fileName: string, runtime: DemoRuntimeConfig): string | null {
  if (!runtime.enabled) return null
  if (normalizeFileName(fileName) === normalizeFileName(runtime.config.model.fileName)) return null

  return `Demo mode expects '${runtime.config.model.fileName}'. Upload that model or run without DEMO_MODE.`
}

export function isStoreyIncludedInDemoScope(storeyName: string, config: DemoConfig): boolean {
  const normalizedStoreyName = normalizeDemoFloorName(storeyName)
  const excluded = new Set(config.scope.excludedFloors.map(normalizeDemoFloorName))
  if (excluded.has(normalizedStoreyName)) return false

  const included = new Set(config.scope.includedFloors.map(normalizeDemoFloorName))
  return included.has(normalizedStoreyName)
}

export function normalizeDemoFloorName(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().normalize('NFC').toLowerCase()
}

export function parseDemoRuntimeConfig(rawConfig: unknown): { enabled: true; config: DemoConfig } {
  const parsed = demoConfigSchema.safeParse(rawConfig)
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
    throw new Error(`Demo mode config is invalid: ${message}`)
  }

  return { enabled: true, config: parsed.data }
}

function normalizeFileName(name: string): string {
  return name.trim().toLowerCase()
}
