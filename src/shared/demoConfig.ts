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
    generateMissingRoutes: z.boolean(),
    createRevitElements: z.boolean(),
    showDebugOverlay: z.boolean(),
  }),
  presentation: z.object({
    showBeforeAfter: z.boolean(),
    highlightGeneratedRoutes: z.boolean(),
    limitToDemoArea: z.boolean(),
  }),
})

export type DemoConfig = z.infer<typeof demoConfigSchema>

declare const __BIMPIPE_DEMO_CONFIG__: unknown

export type DemoRuntimeConfig = { enabled: false } | { enabled: true; config: DemoConfig }

export function getDemoRuntimeConfig(): DemoRuntimeConfig {
  if (!import.meta.env.DEMO_MODE) return { enabled: false }

  const parsed = demoConfigSchema.safeParse(__BIMPIPE_DEMO_CONFIG__)
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
    throw new Error(`Demo mode config is invalid: ${message}`)
  }

  return { enabled: true, config: parsed.data }
}

export function buildDemoModeUploadError(fileName: string, runtime: DemoRuntimeConfig): string | null {
  if (!runtime.enabled) return null
  if (fileName === runtime.config.model.fileName) return null

  return `Demo mode expects '${runtime.config.model.fileName}'. Upload that model or run without DEMO_MODE.`
}

export function isStoreyIncludedInDemoScope(storeyName: string, config: DemoConfig): boolean {
  const normalized = storeyName.trim()
  if (config.scope.excludedFloors.includes(normalized)) return false
  return config.scope.includedFloors.includes(normalized)
}
