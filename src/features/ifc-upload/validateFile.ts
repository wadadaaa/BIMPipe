export const MAX_FILE_SIZE_MB = 500
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

/** Storey envelope (documentation value; not enforced in code). */
export const MAX_STOREYS = 64

export const FILE_TOO_LARGE_MESSAGE =
  `File exceeds ${MAX_FILE_SIZE_MB} MB. Export linked files as separate IFCs and upload them together.`

export function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.ifc')) return 'Only .ifc files are accepted.'
  if (file.size === 0) return 'File is empty.'
  if (file.size > MAX_FILE_SIZE) return FILE_TOO_LARGE_MESSAGE
  return null
}
