import type { ReactNode } from 'react'
import type { ThemeMode } from '@/app/App'
import { BrandMark } from '@/shared/BrandMark'
import './TopBar.css'

interface TopBarProps {
  modelFileName: string | null
  currentStep: 1 | 2 | 3 | 4
  theme: ThemeMode
  onToggleTheme: () => void
}

const STEPS: { label: string; hint: string }[] = [
  { label: 'Upload', hint: 'Load an IFC model' },
  { label: 'Select floor', hint: 'Choose a storey' },
  { label: 'Review', hint: 'Adjust riser placement' },
  { label: 'Export', hint: 'Download updated IFC' },
]

export function TopBar({
  modelFileName,
  currentStep,
  theme,
  onToggleTheme,
}: TopBarProps) {
  return (
    <header className="topbar" role="banner">
      <div className="topbar__brand" aria-label="BIMPipe">
        <BrandMark className="topbar__mark" size={20} />
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
            <svg className="topbar__file-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3.5 2h6.5l3 3v9a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V2.5A.5.5 0 0 1 3.5 2Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="topbar__file-name">{modelFileName}</span>
          </span>
        )}
        <button
          className="topbar__theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <ThemeToggleIcon theme={theme} />
        </button>
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
      <span className="topbar__step-marker" aria-hidden="true">
        {state === 'done' ? (
          <svg viewBox="0 0 12 12" fill="none">
            <path
              d="M3 6.2L5.1 8.3L9 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span className="topbar__step-num">{String(index).padStart(2, '0')}</span>
        )}
      </span>
      <span className="topbar__step-label">{label}</span>
    </div>
  )
}

function ThemeToggleIcon({ theme }: { theme: ThemeMode }) {
  if (theme === 'dark') {
    return (
      <svg
        className="topbar__theme-icon"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg
      className="topbar__theme-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
