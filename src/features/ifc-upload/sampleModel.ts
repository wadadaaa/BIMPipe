export interface SampleModel {
  /** Short label shown on the upload screen. */
  label: string
  /** File name given to the constructed File — the regular upload path (validation, demo checks) sees this. */
  fileName: string
  /** Public asset path served by Vite from `public/`. */
  url: string
  /** Human-readable download size hint. */
  sizeLabel: string
}

export const DUPLEX_MEP_SAMPLE: SampleModel = {
  label: 'Duplex MEP',
  fileName: 'Duplex_MEP_20110907.ifc',
  url: '/samples/Duplex_MEP_20110907.ifc',
  sizeLabel: '17 MB',
}

/**
 * Downloads a bundled sample model and wraps it in a `File`, so callers can
 * feed it through the exact same path as a user-picked file. Failures throw
 * with an explicit reason for the upload error surface.
 */
export async function fetchSampleModelFile(sample: SampleModel = DUPLEX_MEP_SAMPLE): Promise<File> {
  let response: Response
  try {
    response = await fetch(sample.url)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error'
    throw new Error(`Failed to download sample model '${sample.fileName}': ${reason}`)
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download sample model '${sample.fileName}': HTTP ${response.status}`,
    )
  }

  const buffer = await response.arrayBuffer()
  return new File([buffer], sample.fileName)
}
