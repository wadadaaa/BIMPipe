import { z } from 'zod'

const demoConfigSchema = z.object({
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

export function getDemoRuntimeConfig(): { enabled: false } | { enabled: true; config: DemoConfig } {
  if (!import.meta.env.DEMO_MODE) return { enabled: false }

  const parsed = demoConfigSchema.safeParse(__BIMPIPE_DEMO_CONFIG__)
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
    throw new Error(`Demo mode config is invalid: ${message}`)
  }

  return { enabled: true, config: parsed.data }
}

export async function validateDemoAssetPath(assetPath: string): Promise<void> {
  const response = await fetch(`/${assetPath.replace(/^\/+/, '')}`, { method: 'HEAD' })
  if (!response.ok) {
    throw new Error(
      `Demo model file was not found at '${assetPath}'. Place ADAM_10.ifc at this path and restart 'pnpm demo:adam10'.`,
    )
  }
}

export function isStoreyIncludedInDemoScope(storeyName: string, config: DemoConfig): boolean {
  const normalized = storeyName.trim()
  if (config.scope.excludedFloors.includes(normalized)) return false
  return config.scope.includedFloors.includes(normalized)
}
