import type { ReactNode } from 'react'
import './TopBar.css'

interface TopBarProps {
  modelFileName: string | null
  currentStep: 1 | 2 | 3 | 4
}

const STEPS: { label: string; hint: string }[] = [
  { label: 'Upload', hint: 'Load an IFC model' },
  { label: 'Select floor', hint: 'Choose a storey' },
  { label: 'Review', hint: 'Adjust riser placement' },
  { label: 'Export', hint: 'Download updated IFC' },
]

export function TopBar({ modelFileName, currentStep }: TopBarProps) {
  return (
    <header className="topbar" role="banner">
      <div className="topbar__brand" aria-label="BIMPipe">
        <svg
          className="topbar__mark"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M10 3.5V7.5M10 12.5V16.5M3.5 10H7.5M12.5 10H16.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="topbar__wordmark">BIMPipe</span>
      </div>

      <nav className="topbar__steps" aria-label="Workflow progress">
        {STEPS.map(({ label, hint }, i) => {
          const n = i + 1
          const state = n < currentStep ? 'done' : n === currentStep ? 'active' : 'idle'
          return (
            <StepItem key={n} index={n} label={label} hint={hint} state={state} />
          )
        })}
      </nav>

      <div className="topbar__end">
        {modelFileName && (
          <span className="topbar__file" title={modelFileName}>
            {modelFileName}
          </span>
        )}
      </div>
    </header>
  )
}

function StepItem({
  index,
  label,
  hint,
  state,
}: {
  index: number
  label: string
  hint: string
  state: 'idle' | 'active' | 'done'
}): ReactNode {
  return (
    <div
      className={`topbar__step topbar__step--${state}`}
      title={hint}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span className="topbar__step-num">{String(index).padStart(2, '0')}</span>
      <span className="topbar__step-label">{label}</span>
    </div>
  )
}
