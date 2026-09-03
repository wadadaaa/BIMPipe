import type { Fixture, KitchenArea, Riser, RiserId } from '@/domain/types'
import type { WetCoreSuggestedStack } from '@/shared/routes/buildSuggestedRisers'
import { formatLengthM, type LengthUnit } from '@/shared/lengthUnits'
import { detectPlanUnits } from '@/shared/routes/planGeometry'
import { describePlacementRule, describeWetCoreMembers, describeWetCoreStackPlacement } from './wetCoreCopy'
import './RisersPanel.css'

interface RisersPanelProps {
  risers: Riser[]
  fixtures: Fixture[]
  kitchens: KitchenArea[]
  isAddingRiser: boolean
  onToggleAddMode: () => void
  onSuggestRisers: () => void
  onRemove: (id: RiserId) => void
  canDownloadIfc?: boolean
  downloadMode?: 'full' | null
  downloadError?: string | null
  onDownloadFullIfc?: () => void
  sanitaryRouteLimitations?: string[]
  demoFlowEnabled?: boolean
  demoFloorOpened?: boolean
  sanitaryRouteCount?: number
  /**
   * Length unit declared by the model's IfcUnitAssignment; null when unknown.
   * Positions here are viewer coordinates, which web-ifc normalizes to metres
   * whenever the model declares its length unit, so a resolved unit (mm/cm/m)
   * means the coordinates are already metres. Only when the unit is unknown do
   * we fall back to the coordinate-magnitude heuristic.
   */
  modelLengthUnit?: LengthUnit | null
  /** Wet-core stacks of the last suggest run (V3); null in demo mode / before suggesting. */
  wetCoreStacks?: WetCoreSuggestedStack[] | null
  /** Async suggest lifecycle (V3). */
  isSuggestingRisers?: boolean
  suggestProgress?: { processed: number; total: number; storeyName: string | null } | null
  suggestError?: string | null
  onCancelSuggestRisers?: () => void
}

export function RisersPanel({
  risers,
  fixtures,
  kitchens,
  isAddingRiser,
  onToggleAddMode,
  onSuggestRisers,
  onRemove,
  canDownloadIfc = false,
  downloadMode = null,
  downloadError = null,
  onDownloadFullIfc = () => {},
  sanitaryRouteLimitations = [],
  demoFlowEnabled = false,
  demoFloorOpened = false,
  sanitaryRouteCount = 0,
  modelLengthUnit = null,
  wetCoreStacks = null,
  isSuggestingRisers = false,
  suggestProgress = null,
  suggestError = null,
  onCancelSuggestRisers = () => {},
}: RisersPanelProps) {
  const canSuggest =
    fixtures.some((fixture) => fixture.position !== null) ||
    kitchens.some((kitchen) => kitchen.position !== null)
  const wetCoreStackById = new Map((wetCoreStacks ?? []).map((stack) => [stack.stackId, stack]))
  const suggestTitle = demoFlowEnabled
    ? 'Auto-place one riser per toilet and one outer-corner riser per kitchen.'
    : 'Auto-place one riser stack per wet core (fixtures within 2.6 m of each other) and one outer-corner stack per kitchen. Dragged and manually added stacks are kept.'
  const emptyCopy = demoFlowEnabled
    ? 'No risers placed yet. Use Suggest to generate one riser per toilet and one per kitchen, or place them manually.'
    : 'No risers placed yet. Use Suggest to generate one riser stack per wet core and one per kitchen, or place them manually.'
  const coordinateUnit: LengthUnit =
    modelLengthUnit !== null
      ? 'm'
      : detectPlanUnits([
          ...risers.map((riser) => riser.position),
          ...fixtures.flatMap((fixture) => (fixture.position ? [fixture.position] : [])),
          ...kitchens.flatMap((kitchen) => (kitchen.position ? [kitchen.position] : [])),
        ])
  const positionedFixtureCount = demoFlowEnabled
    ? fixtures.filter((fixture) => fixture.position !== null).length
    : 0
  const positionedKitchenCount = demoFlowEnabled
    ? kitchens.filter((kitchen) => kitchen.position !== null).length
    : 0
  const isDownloadingFullIfc = downloadMode === 'full'
  const hasRoutePreview = sanitaryRouteCount > 0
  const demoBlocker = !demoFloorOpened
    ? 'Open an included ADAM_10 demo floor before placing risers.'
    : !canSuggest
      ? 'No sanitary fixture positions detected on this floor yet.'
    : risers.length === 0
      ? 'Place risers before sanitary routing can preview or export routes.'
      : !hasRoutePreview
        ? 'Sanitary routing is waiting for valid fixture-to-riser geometry.'
        : null

  return (
    <div className="risers-panel">
      <div className="risers-panel__toolbar">
        <button
          className={[
            'risers-panel__btn',
            isAddingRiser ? 'risers-panel__btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleAddMode}
        >
          {isAddingRiser ? 'Cancel' : '+ Add riser'}
        </button>
        <button
          className="risers-panel__btn risers-panel__btn--ghost"
          onClick={onSuggestRisers}
          disabled={!canSuggest || isSuggestingRisers}
          title={canSuggest ? suggestTitle : 'Open a floor with fixtures or kitchens first'}
        >
          {isSuggestingRisers ? 'Suggesting…' : risers.length > 0 ? 'Re-suggest' : 'Suggest'}
        </button>
      </div>

      {isSuggestingRisers && (
        <div className="risers-panel__hint" role="status" data-testid="suggest-progress">
          <span>
            {suggestProgress === null
              ? 'Scanning the building for fixtures…'
              : `Scanning storey ${suggestProgress.processed} of ${suggestProgress.total}`}
            {suggestProgress?.storeyName ? (
              <>
                {' '}(<span dir="auto">{suggestProgress.storeyName}</span>)
              </>
            ) : null}
            {' '}— stacks are bounded by where matching wet cores exist.
          </span>{' '}
          <button type="button" className="risers-panel__btn risers-panel__btn--ghost" onClick={onCancelSuggestRisers}>
            Cancel
          </button>
        </div>
      )}

      {suggestError !== null && (
        <p className="risers-panel__error" role="alert" dir="auto">
          Suggest failed: {suggestError}
        </p>
      )}

      {isAddingRiser && (
        <p className="risers-panel__hint">Click on the floor plan to place a riser, then drag it to the exact corner if needed.</p>
      )}

      {demoFlowEnabled && (
        <section className="risers-panel__demo-flow" aria-label="Sanitary demo flow">
          <div className="risers-panel__demo-flow-header">
            <span className="risers-panel__demo-kicker">Route demo flow</span>
            <strong>{demoBlocker ? 'Action needed' : 'Ready to export'}</strong>
          </div>
          <ol className="risers-panel__demo-steps">
            <DemoStep done={demoFloorOpened} label="ADAM_10 floor opened" detail="Use an included demo floor before routing." />
            <DemoStep
              done={canSuggest}
              label="Sanitary inputs checked"
              detail={`${positionedFixtureCount} fixture(s), ${positionedKitchenCount} kitchen area(s) with plan points`}
            />
            <DemoStep
              done={risers.length > 0}
              label="Risers selected"
              detail={risers.length > 0 ? `${risers.length} selected/placed riser(s)` : 'Use Place risers from Toilets, Suggest here, or add one manually.'}
            />
            <DemoStep
              done={hasRoutePreview}
              label="Route preview generated"
              detail={hasRoutePreview ? `${sanitaryRouteCount} route(s) visible in preview/export` : 'Routes appear after valid risers and fixture inputs.'}
            />
          </ol>
          {demoBlocker ? (
            <p className="risers-panel__demo-blocker" role="status">{demoBlocker}</p>
          ) : (
            <p className="risers-panel__demo-ready" role="status">Sanitary route preview is ready for IFC export.</p>
          )}
          <ul className="risers-panel__demo-assumptions">
            <li>WC routes use Ø110 intent.</li>
            <li>Small fixtures use Ø50 branches into Ø63 collection mains where needed.</li>
            <li>Horizontal sanitary routes carry 2.0% slope toward the riser.</li>
            <li>Grouped branches prefer approximately 45° joins where geometry allows.</li>
          </ul>
        </section>
      )}

      <div className="risers-panel__download-actions">
        <button
          className="risers-panel__download-btn"
          onClick={onDownloadFullIfc}
          disabled={!canDownloadIfc || downloadMode !== null}
        >
          <DownloadIcon spinning={isDownloadingFullIfc} />
          <span>{isDownloadingFullIfc ? 'Preparing IFC' : 'Download IFC'}</span>
        </button>
      </div>

      {downloadError && (
        <p className="risers-panel__error" role="alert">
          {downloadError}
        </p>
      )}

      {sanitaryRouteLimitations.length > 0 && !demoFlowEnabled && (
        <div className="risers-panel__hint" role="status">
          <strong>Sanitary routing preview notes</strong>
          <ul className="risers-panel__limitations">
            {sanitaryRouteLimitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {risers.length === 0 ? (
        <div className="risers-panel__empty">
          <span className="risers-panel__empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 3" />
              <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p>{emptyCopy}</p>
        </div>
      ) : (
        <div className="risers-panel__list">
          <div className="risers-panel__summary">
            <span className="risers-panel__summary-label">Placed</span>
            <strong className="risers-panel__summary-count">{risers.length}</strong>
          </div>

          {risers.map((riser, index) => {
            const wetCoreStack = wetCoreStackById.get(riser.stackId)
            const flagged =
              wetCoreStack?.anchor === 'wet-core' &&
              wetCoreStack.placement.rule === 'centroid' &&
              wetCoreStack.placement.flagged
            return (
            <div
              key={riser.id}
              className={[
                'risers-panel__item',
                'risers-panel__item--enter',
                flagged ? 'risers-panel__item--flagged' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
              title={wetCoreStack === undefined ? undefined : describeWetCoreStackPlacement(wetCoreStack)}
            >
              <span className="risers-panel__item-marker">{riser.stackLabel}</span>
              <span className="risers-panel__item-coords">
                {demoFlowEnabled
                  ? describeRiserLocation(riser, fixtures, kitchens, coordinateUnit)
                  : formatRiserPlanPosition(riser.position, coordinateUnit)}
                {wetCoreStack !== undefined && (
                  <small className="risers-panel__item-placement" data-testid="stack-placement">
                    {wetCoreStack.anchor === 'wet-core'
                      ? `${describeWetCoreMembers(wetCoreStack.core)} · ${describePlacementRule(wetCoreStack)}`
                      : `kitchen · ${describePlacementRule(wetCoreStack)}`}
                  </small>
                )}
              </span>
              <span className="risers-panel__item-source" title="Riser source">
                {riser.source ?? "placed"}
              </span>
              <button
                className="risers-panel__item-delete"
                onClick={() => onRemove(riser.id)}
                aria-label={`Remove riser ${riser.stackLabel}`}
                title="Remove riser"
              >
                ×
              </button>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Compact placement tag for the riser list ("shaft", "free cell", "wall side", "needs review"). */
/**
 * Viewer plan coordinates are (x, z) with z = -(IFC Y); display IFC-style
 * (X, Y) so the sign matches the exported model (the exporter writes -z as Y).
 */
function formatRiserPlanPosition(
  position: { x: number; z: number },
  unit: LengthUnit,
): string {
  return `${formatLengthM(position.x, unit)}, ${formatLengthM(-position.z, unit)}`
}

function describeRiserLocation(
  riser: Riser,
  fixtures: Fixture[],
  kitchens: KitchenArea[],
  unit: LengthUnit,
): string {
  const anchors = [
    ...fixtures
      .filter((fixture) => fixture.position !== null)
      .map((fixture, index) => ({ label: `WC-${index + 1}`, x: fixture.position!.x, z: fixture.position!.z })),
    ...kitchens
      .filter((kitchen) => kitchen.position !== null)
      .map((kitchen, index) => ({ label: `Kitchen-${index + 1}`, x: kitchen.position!.x, z: kitchen.position!.z })),
  ]

  const nearest = anchors
    .map((anchor) => ({
      ...anchor,
      distance: Math.hypot(riser.position.x - anchor.x, riser.position.z - anchor.z),
    }))
    .sort((a, b) => a.distance - b.distance)[0]

  if (!nearest) return formatRiserPlanPosition(riser.position, unit)
  return `near ${nearest.label} · ${formatLengthM(nearest.distance, unit)}`
}

function DemoStep({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className={['risers-panel__demo-step', done ? 'risers-panel__demo-step--done' : ''].filter(Boolean).join(' ')}>
      <span className="risers-panel__demo-step-dot" aria-hidden="true">{done ? '✓' : '•'}</span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </li>
  )
}

function DownloadIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return <span className="risers-panel__btn-spinner" aria-hidden="true" />
  }
  return (
    <svg
      className="risers-panel__btn-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 2v8.5M4.5 7L8 10.5L11.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 13h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
