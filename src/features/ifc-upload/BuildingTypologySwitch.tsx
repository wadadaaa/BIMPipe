import { BUILDING_TYPOLOGIES, BUILDING_TYPOLOGY_LABEL, type BuildingTypology } from '@/domain/typology'

interface BuildingTypologySwitchProps {
  value: BuildingTypology
  onChange: (typology: BuildingTypology) => void
  disabled?: boolean
}

/**
 * Segmented radio group for the building typology (G3). Manual for now: the
 * choice drives the plain-mode placement rules (core-shaft stacks, row
 * collectors and the longer branch limit for offices) the next time the user
 * presses Suggest — changing it never re-runs a suggestion on its own.
 */
export function BuildingTypologySwitch({ value, onChange, disabled = false }: BuildingTypologySwitchProps) {
  return (
    <fieldset className="ifc-upload__typology" disabled={disabled} data-testid="building-typology">
      <legend className="ifc-upload__meta-label">Building type</legend>
      <div className="ifc-upload__typology-options" role="radiogroup" aria-label="Building type">
        {BUILDING_TYPOLOGIES.map((typology) => {
          const checked = typology === value
          return (
            <label
              key={typology}
              className={['ifc-upload__typology-option', checked ? 'ifc-upload__typology-option--active' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="radio"
                name="building-typology"
                value={typology}
                checked={checked}
                onChange={() => onChange(typology)}
                className="ifc-upload__typology-input"
              />
              {BUILDING_TYPOLOGY_LABEL[typology]}
            </label>
          )
        })}
      </div>
      <p className="ifc-upload__typology-hint">Manual for now; auto-detection later. Applies on the next Suggest.</p>
    </fieldset>
  )
}
