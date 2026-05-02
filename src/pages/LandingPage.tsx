import type { ThemeMode } from '@/app/App'
import './LandingPage.css'

interface LandingPageProps {
  theme: ThemeMode
  onToggleTheme: () => void
}

const STEPS: Array<{ index: string; title: string; copy: string }> = [
  {
    index: '01',
    title: 'Upload',
    copy: 'A single .ifc file. Parsed locally. Nothing leaves your machine.',
  },
  {
    index: '02',
    title: 'Detect',
    copy: 'Toilets and kitchens are extracted. Floors group by IfcBuildingStorey.',
  },
  {
    index: '03',
    title: 'Place',
    copy: 'Risers auto-suggest one per fixture, vertically aligned across floors.',
  },
  {
    index: '04',
    title: 'Adjust',
    copy: 'Drag pins to the exact corner. Manual overrides survive re-suggest.',
  },
  {
    index: '05',
    title: 'Export',
    copy: 'An enriched IFC ready for Revit, ArchiCAD, or any IFC-aware tool.',
  },
]

const PRINCIPLES: Array<{ label: string; copy: string }> = [
  {
    label: 'In-browser, end to end',
    copy: 'No server upload, no auth, no waiting room. Parsed with web-ifc, never leaves the tab.',
  },
  {
    label: 'Manual override always wins',
    copy: 'Re-suggest replaces auto risers without touching anything you placed by hand.',
  },
  {
    label: 'Vertical alignment by default',
    copy: 'A riser at (x, y) on one floor implies the same shaft on every floor it spans.',
  },
  {
    label: 'Deterministic placement',
    copy: 'Same input IFC produces identical riser positions, IDs, and ordering.',
  },
  {
    label: 'IFC in, IFC out',
    copy: 'Stays inside the existing BIM pipeline. The export opens in any IFC-aware tool.',
  },
  {
    label: 'Hebrew & RTL ready',
    copy: 'Floor names like קומה 2 flow naturally; mixed-direction text gets dir="auto".',
  },
]

export function LandingPage({ theme, onToggleTheme }: LandingPageProps) {
  return (
    <div className="landing">
      <header className="landing__nav">
        <a className="landing__brand" href="/" aria-label="BIMPipe">
          <span className="landing__brand-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M10 3.5V7.5M10 12.5V16.5M3.5 10H7.5M12.5 10H16.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span>BIMPipe</span>
        </a>
        <nav className="landing__nav-links" aria-label="Sections">
          <a href="#pipeline">Pipeline</a>
          <a href="#principles">Principles</a>
        </nav>
        <div className="landing__nav-actions">
          <button
            type="button"
            className="landing__icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <a className="landing__cta" href="/app">
            Open app
          </a>
        </div>
      </header>

      <section className="landing__hero">
        <span className="landing__tag">
          <DotMark />
          <span>Sanitary &amp; drainage planning, IFC-native</span>
        </span>
        <h1 className="landing__h1">
          The riser layer
          <br />
          for your IFC.
        </h1>
        <p className="landing__lede">
          Drop an architect's IFC. See every toilet and kitchen detected.
          Place vertical risers in seconds. Hand a clean IFC back to Revit.
        </p>
        <div className="landing__hero-cta">
          <a className="landing__cta landing__cta--primary" href="/app">
            Try it with your IFC
          </a>
          <a className="landing__cta landing__cta--ghost" href="#pipeline">
            See how it works
          </a>
        </div>
        <div className="landing__meta">
          <span>Web-only · nothing uploaded</span>
          <span className="landing__meta-sep" aria-hidden="true">—</span>
          <span>Up to 50 MB IFC · 30 storeys</span>
        </div>

        <figure className="landing__shot">
          <div className="landing__shot-frame">
            <div className="landing__shot-bar" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <img
              key={theme}
              src={
                theme === 'light'
                  ? '/landing/workspace-placed-light.png'
                  : '/landing/workspace-placed-dark.png'
              }
              alt="BIMPipe workspace with seven risers placed across an architectural floor plan"
              loading="eager"
              decoding="async"
              width="1600"
              height="1000"
            />
          </div>
        </figure>
      </section>

      <section id="pipeline" className="landing__pipeline">
        <div className="landing__section-head">
          <span className="landing__kicker">// pipeline</span>
          <h2 className="landing__h2">Five steps. Each one explicit.</h2>
        </div>
        <ol className="landing__steps">
          {STEPS.map((step) => (
            <li key={step.index} className="landing__step">
              <span className="landing__step-index">{step.index}</span>
              <h3 className="landing__step-title">{step.title}</h3>
              <p className="landing__step-copy">{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="principles" className="landing__principles">
        <div className="landing__section-head">
          <span className="landing__kicker">// principles</span>
          <h2 className="landing__h2">Opinionated where it counts.</h2>
        </div>
        <div className="landing__principles-grid">
          {PRINCIPLES.map((p) => (
            <article key={p.label} className="landing__principle">
              <h3 className="landing__principle-label">{p.label}</h3>
              <p className="landing__principle-copy">{p.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing__final">
        <span className="landing__kicker">// ready</span>
        <h2 className="landing__h1 landing__h1--final">Drop in your IFC.</h2>
        <p className="landing__lede">
          No signup. No queue. The model is parsed locally, the export is yours.
        </p>
        <a className="landing__cta landing__cta--primary landing__cta--lg" href="/app">
          Open BIMPipe
        </a>
      </section>

      <footer className="landing__footer">
        <div className="landing__footer-left">
          <span className="landing__brand-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M10 3.5V7.5M10 12.5V16.5M3.5 10H7.5M12.5 10H16.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span>BIMPipe</span>
        </div>
        <span className="landing__footer-tag">A scalpel inside the BIM pipeline.</span>
      </footer>
    </div>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
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

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DotMark() {
  return (
    <span className="landing__tag-dot" aria-hidden="true" />
  )
}
