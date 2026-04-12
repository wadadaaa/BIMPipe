import { useRef, useState } from 'react'
import { validateFile } from './validateFile'
import './IfcUpload.css'

interface IfcUploadProps {
  onFileAccepted: (file: File) => void
  isLoading: boolean
  error: string | null
  fileName?: string | null
  storeyCount?: number
}

export function IfcUpload({
  onFileAccepted,
  isLoading,
  error,
  fileName = null,
  storeyCount = 0,
}: IfcUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  function handleFile(file: File) {
    const err = validateFile(file)
    if (err) {
      setLocalError(err)
      return
    }
    setLocalError(null)
    onFileAccepted(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
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
              Drop an <strong>.ifc</strong> file or <span className="ifc-upload__cta">browse</span>
            </span>
          </div>
        )}
      </div>

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

      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        onChange={handleChange}
        aria-hidden="true"
      />
    </section>
  )
}
