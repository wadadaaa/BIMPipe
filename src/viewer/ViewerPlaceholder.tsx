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
          {isViewerLoading && !error && (
            <div className="viewer-placeholder__overlay-loader" role="status" aria-label="Loading floor viewer">
              <span className="viewer-placeholder__overlay-spinner" aria-hidden="true" />
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
