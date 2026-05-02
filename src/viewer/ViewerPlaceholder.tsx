import { ViewTransition } from '@/shared/reactViewTransition'
import './ViewerPlaceholder.css'

interface ViewerPlaceholderProps {
  modelFileName?: string | null
  selectedStoreyName?: string | null
  isViewerLoading?: boolean
  error?: string | null
  storeyCount?: number
}

export function ViewerPlaceholder({
  modelFileName = null,
  selectedStoreyName = null,
  isViewerLoading = false,
  error = null,
  storeyCount = 0,
}: ViewerPlaceholderProps) {
  const status = error
    ? 'Geometry issue'
    : isViewerLoading
      ? 'Loading viewer'
      : modelFileName
        ? 'Model loaded'
        : 'Awaiting IFC'
  const message = error
    ? error
    : isViewerLoading
      ? `Preparing ${selectedStoreyName ? `floor ${selectedStoreyName}` : 'selected floor'} and extracting geometry...`
      : modelFileName
        ? 'Choose a floor from the left stack to activate the interactive viewer.'
        : 'Upload an IFC file to begin floor inspection.'

  return (
    <div className="viewer-placeholder">
      <div className="viewer-placeholder__hud">
        <div className="viewer-placeholder__chips">
          <ViewTransition name="viewer-stage-status" share="morph" default="none">
            <span className="viewer-placeholder__chip viewer-placeholder__chip--accent">
              {status}
            </span>
          </ViewTransition>
          {storeyCount > 0 && (
            <span className="viewer-placeholder__chip">{storeyCount} storeys</span>
          )}
        </div>
      </div>

      <div className="viewer-placeholder__overlay">
        <div className="viewer-placeholder__overlay-card">
          {isViewerLoading && !error ? (
            <div className="viewer-placeholder__overlay-loader" role="status" aria-label="Loading floor viewer">
              <span className="viewer-placeholder__overlay-spinner" aria-hidden="true" />
            </div>
          ) : (
            <div className={`viewer-placeholder__overlay-hero viewer-placeholder__overlay-hero--${heroVariant(error, modelFileName)}`} aria-hidden="true">
              <PlaceholderIllustration error={Boolean(error)} hasModel={Boolean(modelFileName)} />
            </div>
          )}
          <p className="viewer-placeholder__overlay-kicker">
            {error ? 'Geometry issue' : isViewerLoading ? 'Opening floor' : modelFileName ? 'Ready for floor selection' : 'Start with IFC'}
          </p>
          <p className="viewer-placeholder__overlay-text">{message}</p>
        </div>
      </div>

    </div>
  )
}

function heroVariant(error: string | null, modelFileName: string | null): 'idle' | 'ready' | 'error' {
  if (error) return 'error'
  if (modelFileName) return 'ready'
  return 'idle'
}

function PlaceholderIllustration({ error, hasModel }: { error: boolean; hasModel: boolean }) {
  if (error) {
    return (
      <svg viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
        <path d="M32 22v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="32" cy="42" r="1.4" fill="currentColor" />
      </svg>
    )
  }
  if (hasModel) {
    return (
      <svg viewBox="0 0 64 64" fill="none">
        <rect x="14" y="18" width="36" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
        <path d="M14 28h36M14 38h36M24 18v32M40 18v32" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
        <circle cx="40" cy="38" r="3" fill="currentColor" />
        <path d="M40 26v9M40 41v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 64 64" fill="none">
      <path
        d="M14 44 32 14l18 30Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M32 22v14M26 36h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="42" r="1.6" fill="currentColor" />
    </svg>
  )
}
