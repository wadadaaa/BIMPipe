import { useRef, useState } from 'react'
import { validateFile } from './validateFile'
import { DUPLEX_MEP_SAMPLE, fetchSampleModelFile } from './sampleModel'
import './IfcUpload.css'

interface IfcUploadProps {
  onFileAccepted: (file: File) => void
  /**
   * Multi-file selection (host + linked models). When provided, a multi-file
   * pick/drop is delivered here in selection order (first file = host);
   * single-file picks still go through `onFileAccepted` so existing flows are
   * byte-identical to before.
   */
  onFilesAccepted?: (files: File[]) => void
  isLoading: boolean
  error: string | null
  fileName?: string | null
  /** Linked (non-host) model file names, shown under the model card. */
  linkedFileNames?: string[]
  storeyCount?: number
  showSampleModel?: boolean
}

export function IfcUpload({
  onFileAccepted,
  onFilesAccepted,
  isLoading,
  error,
  fileName = null,
  linkedFileNames = [],
  storeyCount = 0,
  showSampleModel = true,
}: IfcUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isFetchingSample, setIsFetchingSample] = useState(false)

  function handleFile(file: File) {
    handleFiles([file])
  }

  function handleFiles(files: File[]) {
    if (files.length === 0) return
    for (const file of files) {
      const err = validateFile(file)
      if (err) {
        // Name the offending file when several were picked; a single pick
        // keeps the original bare message.
        setLocalError(files.length > 1 ? `${file.name}: ${err}` : err)
        return
      }
    }
    setLocalError(null)
    if (files.length > 1 && onFilesAccepted) {
      onFilesAccepted(files)
      return
    }
    onFileAccepted(files[0])
  }

  async function handleLoadSample() {
    setIsFetchingSample(true)
    setLocalError(null)
    try {
      const file = await fetchSampleModelFile()
      // Same entry point as a user-picked file: validation, then onFileAccepted.
      handleFile(file)
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Failed to download the sample model.',
      )
    } finally {
      setIsFetchingSample(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  const displayError = localError ?? error

  return (
    <section className="ifc-upload" aria-label="Upload IFC model">
      <div
        className={[
          'ifc-upload__zone',
          dragOver ? 'ifc-upload__zone--dragover' : '',
          isLoading ? 'ifc-upload__zone--loading' : '',
          fileName ? 'ifc-upload__zone--loaded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => !isLoading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        aria-label="Upload IFC file"
      >
        {isLoading ? (
          <span className="ifc-upload__spinner" aria-label="Loading" />
        ) : fileName ? (
          <div className="ifc-upload__loaded">
            <svg className="ifc-upload__loaded-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.5 10L9 12.5L13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="ifc-upload__loaded-label">Replace model</span>
          </div>
        ) : (
          <div className="ifc-upload__idle">
            <svg className="ifc-upload__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 18.5A4.5 4.5 0 0 1 4 10a6 6 0 0 1 11.8-1.5A3.5 3.5 0 1 1 19 15h-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="ifc-upload__label">
              Drop <strong>.ifc</strong> files or <span className="ifc-upload__cta">browse</span>
              <br />
              <span className="ifc-upload__label-hint">
                Pick several to link models — the first file is the host
              </span>
            </span>
          </div>
        )}
      </div>

      {showSampleModel && !fileName && (
        <p className="ifc-upload__sample">
          Or try a sample model:{' '}
          <button
            type="button"
            className="ifc-upload__sample-button"
            onClick={() => void handleLoadSample()}
            disabled={isFetchingSample || isLoading}
            aria-busy={isFetchingSample}
          >
            {isFetchingSample
              ? `Downloading ${DUPLEX_MEP_SAMPLE.label}…`
              : `${DUPLEX_MEP_SAMPLE.label} (${DUPLEX_MEP_SAMPLE.sizeLabel})`}
          </button>
        </p>
      )}

      {displayError && (
        <p className="ifc-upload__error" role="alert">
          {displayError}
        </p>
      )}

      {(fileName || storeyCount > 0) && (
        <div className="ifc-upload__meta">
          <div className="ifc-upload__meta-card">
            <span className="ifc-upload__meta-label">Model</span>
            <strong className="ifc-upload__meta-value" dir="auto" title={fileName ?? undefined}>
              {fileName ?? '—'}
            </strong>
          </div>
          <div className="ifc-upload__meta-card">
            <span className="ifc-upload__meta-label">Floors</span>
            <strong className="ifc-upload__meta-value">
              {storeyCount > 0 ? storeyCount : '—'}
            </strong>
          </div>
        </div>
      )}

      {linkedFileNames.length > 0 && (
        <div className="ifc-upload__meta ifc-upload__meta--single" aria-label="Linked models">
          <div className="ifc-upload__meta-card">
            <span className="ifc-upload__meta-label">
              Linked {linkedFileNames.length === 1 ? 'model' : 'models'}
            </span>
            {linkedFileNames.map((linkedName) => (
              <strong
                key={linkedName}
                className="ifc-upload__meta-value"
                dir="auto"
                title={linkedName}
              >
                {linkedName}
              </strong>
            ))}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
        aria-hidden="true"
      />
    </section>
  )
}
