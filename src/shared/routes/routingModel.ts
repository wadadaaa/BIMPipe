import type { DemoRuntimeConfig } from '@/shared/demoConfig'

/**
 * The ONE horizontal-routing switch of the workspace (V5).
 *
 * - `branch-runs`: fixture → its wet core's stack (`src/domain/branchRouting.ts`
 *   via `assignFixturesToRisers` + `buildBranchRoutes`). The only horizontal
 *   routing that is built, rendered, listed, validated and exported in plain mode.
 * - `demo-chains`: the legacy riser-to-riser "main sanitary route" plan
 *   (`buildSanitaryRoutes.ts`, `sanitaryRouteExportPlan.ts`). Kept byte-identical
 *   for the demo runtime (parity-checked); never active outside it.
 *
 * Decided once per mount from the demo runtime config and stored in the
 * workspace state; every consumer (page, viewer, sidebar, export, debug JSON)
 * reads `routingModel` instead of testing `demoRuntime.enabled` itself.
 */
export type RoutingModel = 'branch-runs' | 'demo-chains'

export function resolveRoutingModel(demoRuntime: DemoRuntimeConfig): RoutingModel {
  return demoRuntime.enabled ? 'demo-chains' : 'branch-runs'
}

/** Text shown in the Decisions panel and the debug JSON. */
export const ROUTING_MODEL_LABEL: Readonly<Record<RoutingModel, string>> = {
  'branch-runs': 'branch runs (fixture → stack)',
  'demo-chains': 'demo chains (riser-to-riser sanitary routes)',
}

export function describeRoutingModel(model: RoutingModel): string {
  return `Routing model: ${ROUTING_MODEL_LABEL[model]}`
}
