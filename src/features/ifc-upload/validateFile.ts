export const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500 MB

export function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.ifc')) return 'Only .ifc files are accepted.'
  if (file.size === 0) return 'File is empty.'
  if (file.size > MAX_FILE_SIZE) return 'File exceeds 500 MB limit.'
  return null
}
