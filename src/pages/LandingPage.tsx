import type { ThemeMode } from '@/app/App'
import './LandingPage.css'

interface LandingPageProps {
  theme: ThemeMode
  onToggleTheme: () => void
}

const PIPELINE_STEPS: Array<{ index: string; title: string; copy: string; icon: 'upload' | 'detect' | 'place' | 'adjust' | 'export' }> = [
  {
    index: '01',
    title: 'Upload',
    copy: 'Drop a single .ifc file, parsed entirely in your browser. Nothing leaves your machine.',
    icon: 'upload',
  },
  {
    index: '02',
    title: 'Detect',
    copy: 'Toilets and kitchens are extracted from the IFC. Floors are grouped by IfcBuildingStorey.',
    icon: 'detect',
  },
  {
    index: '03',
    title: 'Place',
    copy: 'Risers auto-suggest one per toilet and one per kitchen, vertically aligned across floors.',
    icon: 'place',
  },
  {
    index: '04',
    title: 'Adjust',
    copy: 'Drag pins to the exact corner. Manual overrides survive re-suggest. Everything stays deterministic.',
    icon: 'adjust',
  },
  {
    index: '05',
    title: 'Export',
    copy: 'Download an enriched IFC ready for Revit. Plumbing-only or full model — your call.',
    icon: 'export',
  },
]

const FEATURES: Array<{ title: string; copy: string; icon: 'browser' | 'override' | 'aligned' | 'rtl' | 'deterministic' | 'ifc' }> = [
  {
    title: 'In-browser, end to end',
    copy: 'No server upload, no auth, no waiting room. The IFC is parsed locally with web-ifc and never leaves the tab.',
    icon: 'browser',
  },
  {
    title: 'Manual override always wins',
    copy: 'Re-suggest replaces auto risers without touching anything you placed by hand. Destructive actions ask first.',
    icon: 'override',
  },
  {
    title: 'Vertical alignment by default',
    copy: 'A riser at (x, y) on one floor implies the same shaft on every floor it spans. Misalignment is flagged, not silent.',
    icon: 'aligned',
  },
  {
    title: 'Deterministic placement',
    copy: 'Same input IFC produces identical riser positions, IDs, and ordering. No coin flips, no surprise diffs.',
    icon: 'deterministic',
  },
  {
    title: 'IFC in, IFC out',
    copy: 'Stays inside the existing BIM pipeline. Open the export in Revit, ArchiCAD, or any IFC-aware tool.',
    icon: 'ifc',
  },
  {
    title: 'Hebrew & RTL ready',
    copy: 'Floor names like קומה 2 and מרתף flow naturally. Mixed-direction text gets dir="auto" so layouts stay sane.',
    icon: 'rtl',
  },
]

export function LandingPage({ theme, onToggleTheme }: LandingPageProps) {
  return (
    <div className="landing">
      <header className="landing__nav" role="banner">
        <a href="/" className="landing__brand" aria-label="BIMPipe">
          <BrandMark />
          <span className="landing__brand-word">BIMPipe</span>
        </a>
        <nav className="landing__nav-links" aria-label="Page sections">
          <a href="#pipeline">Pipeline</a>
          <a href="#features">Features</a>
        </nav>
        <div className="landing__nav-actions">
          <button
            type="button"
            className="landing__theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <ThemeIcon theme={theme} />
          </button>
          <a className="landing__cta landing__cta--ghost" href="/app">
            Open app
          </a>
        </div>
      </header>

      <section className="landing__hero">
        <div className="landing__hero-grid">
          <div className="landing__hero-copy">
            <span className="landing__eyebrow">Sanitary &amp; drainage planning · IFC-native</span>
            <h1 className="landing__headline">
              Risers placed.
              <br />
              <span className="landing__headline-accent">Pipeline preserved.</span>
            </h1>
            <p className="landing__lede">
              BIMPipe is a scalpel inside your existing BIM workflow. Drop an architect's IFC,
              see every toilet and kitchen detected, place vertical risers in seconds, and
              hand a clean IFC back to Revit.
            </p>
            <div className="landing__hero-actions">
              <a className="landing__cta landing__cta--primary" href="/app">
                <span>Try it with your IFC</span>
                <ArrowIcon />
              </a>
              <a className="landing__cta landing__cta--text" href="#pipeline">
                See how it works
              </a>
            </div>
            <ul className="landing__hero-meta" aria-label="Key facts">
              <li>
                <DotIcon />
                Web-only · nothing uploaded
              </li>
              <li>
                <DotIcon />
                Up to 50 MB IFC · 30 storeys
              </li>
              <li>
                <DotIcon />
                Plumbing-only or full export
              </li>
            </ul>
          </div>

          <div className="landing__hero-visual" aria-hidden="true">
            <HeroFigure />
          </div>
        </div>
      </section>

      <section id="pipeline" className="landing__pipeline">
        <div className="landing__section-head">
          <span className="landing__eyebrow">The pipeline</span>
          <h2 className="landing__section-title">Five steps. No surprises.</h2>
          <p className="landing__section-copy">
            Every step is explicit, reversible, and fully visible to the engineer.
            Detection is one phase. Placement is another. You decide when each fires.
          </p>
        </div>
        <ol className="landing__steps">
          {PIPELINE_STEPS.map((step, i) => (
            <li
              key={step.index}
              className="landing__step"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="landing__step-marker">
                <span className="landing__step-index">{step.index}</span>
                <span className="landing__step-icon" aria-hidden="true">
                  <StepIcon name={step.icon} />
                </span>
              </div>
              <div className="landing__step-copy">
                <h3 className="landing__step-title">{step.title}</h3>
                <p className="landing__step-text">{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" className="landing__features">
        <div className="landing__section-head">
          <span className="landing__eyebrow">Built for engineers</span>
          <h2 className="landing__section-title">Opinionated where it counts.</h2>
          <p className="landing__section-copy">
            Determinism, manual override, and explicit failure paths are first-class —
            not afterthoughts. BIMPipe complements Revit, it doesn't replace it.
          </p>
        </div>
        <div className="landing__features-grid">
          {FEATURES.map((feature, i) => (
            <article
              key={feature.title}
              className="landing__feature"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="landing__feature-icon" aria-hidden="true">
                <FeatureIcon name={feature.icon} />
              </span>
              <h3 className="landing__feature-title">{feature.title}</h3>
              <p className="landing__feature-copy">{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing__final-cta">
        <div className="landing__final-cta-inner">
          <span className="landing__eyebrow">Ready when you are</span>
          <h2 className="landing__section-title">Drop in your IFC.</h2>
          <p className="landing__section-copy">
            No signup. No queue. The model is parsed locally, the export is yours.
          </p>
          <a className="landing__cta landing__cta--primary landing__cta--large" href="/app">
            <span>Open BIMPipe</span>
            <ArrowIcon />
          </a>
        </div>
      </section>

      <footer className="landing__footer">
        <div className="landing__footer-inner">
          <span className="landing__footer-brand">
            <BrandMark />
            <span>BIMPipe</span>
          </span>
          <span className="landing__footer-tag">A scalpel inside the BIM pipeline.</span>
        </div>
      </footer>
    </div>
  )
}

function BrandMark() {
  return (
    <svg className="landing__mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10 3.5V7.5M10 12.5V16.5M3.5 10H7.5M12.5 10H16.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ThemeIcon({ theme }: { theme: ThemeMode }) {
  if (theme === 'dark') {
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

function ArrowIcon() {
  return (
    <svg
      className="landing__cta-arrow"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function StepIcon({ name }: { name: 'upload' | 'detect' | 'place' | 'adjust' | 'export' }) {
  switch (name) {
    case 'upload':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 16V8M12 8L9 11M12 8L15 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6.5 18.5A4.5 4.5 0 0 1 4 10a6 6 0 0 1 11.8-1.5A3.5 3.5 0 1 1 19 15h-1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'detect':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="11" cy="11" r="2" fill="currentColor" />
        </svg>
      )
    case 'place':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3v6.5l5-3M12 9.5L7 6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M5 11v6l7 4 7-4v-6l-7 4-7-4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'adjust':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12h6M13 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 5v3M12 16v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'export':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 4h11l3 3v13H5V4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 9v6M9 12l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

function FeatureIcon({ name }: { name: 'browser' | 'override' | 'aligned' | 'rtl' | 'deterministic' | 'ifc' }) {
  switch (name) {
    case 'browser':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6.5" cy="7" r="0.7" fill="currentColor" />
          <circle cx="9" cy="7" r="0.7" fill="currentColor" />
          <path d="M9 14h6M12 11v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'override':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 8h11l-3-3M19 16H8l3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'aligned':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3v18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="6" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'deterministic':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12a7 7 0 1 1 7 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M12 19l-3-3M12 19l3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'ifc':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="7" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <rect x="13" y="4" width="7" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 12h2M11 9h2M11 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'rtl':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M16 6l-4 6 4 6M8 6l-4 6 4 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
  }
}

function HeroFigure() {
  return (
    <svg
      className="landing__hero-svg"
      viewBox="0 0 480 360"
      fill="none"
      role="img"
      aria-label="Schematic illustration of an IFC building with vertical riser shafts"
    >
      <defs>
        <linearGradient id="landing-floor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <g className="landing__hero-floors" stroke="currentColor" strokeWidth="1.2">
        {[0, 1, 2, 3, 4].map((i) => {
          const y = 50 + i * 50
          return (
            <g key={i} style={{ animationDelay: `${i * 90}ms` }} className="landing__hero-floor">
              <path
                d={`M120 ${y} L320 ${y - 14} L420 ${y + 6} L220 ${y + 20} Z`}
                fill="url(#landing-floor)"
              />
              <path d={`M120 ${y} L220 ${y + 20}`} opacity="0.4" />
              <path d={`M320 ${y - 14} L420 ${y + 6}`} opacity="0.4" />
            </g>
          )
        })}
      </g>

      <g className="landing__hero-risers">
        {[
          { x: 200, label: 'R1' },
          { x: 270, label: 'R2' },
          { x: 340, label: 'R3' },
        ].map((riser, i) => (
          <g key={riser.label} style={{ animationDelay: `${300 + i * 140}ms` }} className="landing__hero-riser">
            <line
              x1={riser.x}
              y1={40}
              x2={riser.x}
              y2={260}
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.6"
            />
            {[50, 100, 150, 200, 250].map((cy, j) => (
              <circle
                key={cy}
                cx={riser.x}
                cy={cy}
                r="4"
                fill="var(--accent)"
                style={{ animationDelay: `${300 + i * 140 + j * 50}ms` }}
                className="landing__hero-riser-dot"
              />
            ))}
            <g transform={`translate(${riser.x}, 24)`}>
              <rect
                x="-14"
                y="-10"
                width="28"
                height="18"
                rx="9"
                fill="var(--accent-bg)"
                stroke="var(--accent-border)"
              />
              <text
                x="0"
                y="2"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="var(--accent)"
                fontFamily="var(--mono)"
              >
                {riser.label}
              </text>
            </g>
          </g>
        ))}
      </g>
    </svg>
  )
}
