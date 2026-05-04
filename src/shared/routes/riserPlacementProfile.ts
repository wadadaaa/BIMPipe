import { z } from 'zod'

const excludedFloorTypeValues = ['basement', 'roof', 'mezzanine', 'service', 'other'] as const
const penthouseRuleValues = ['exclude_new_risers', 'allow_new_risers'] as const

export const riserPlacementRuleProfileSchema = z.object({
  typicalFloor: z.string().trim().min(1).default('L2'),
  excludedFloorTypes: z.array(z.enum(excludedFloorTypeValues)).default(['basement', 'roof']),
  penthouseRule: z.enum(penthouseRuleValues).default('exclude_new_risers'),
  roomOverlapThreshold: z.number().min(0).max(1).default(0.5),
  fixtureOffsetToleranceMm: z.number().finite().nonnegative().default(450),
  riserCoverageRadiusMm: z.number().finite().positive().default(1800),
  addRiserOnlyWhenNoExistingGroupCoversToilet: z.boolean().default(true),
  createCoordinationIssues: z.boolean().default(true),
})

export type RiserPlacementRuleProfile = z.infer<typeof riserPlacementRuleProfileSchema>

export const DEFAULT_RISER_PLACEMENT_RULE_PROFILE: RiserPlacementRuleProfile = riserPlacementRuleProfileSchema.parse({})

export function resolveRiserPlacementRuleProfile(
  profile: Partial<RiserPlacementRuleProfile> | null | undefined,
): RiserPlacementRuleProfile {
  return riserPlacementRuleProfileSchema.parse(profile ?? {})
}
