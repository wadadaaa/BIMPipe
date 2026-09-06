import type { DrawingPreview } from './buildDrawingPreview'

/** Trigger a browser download of the preview SVG. Browser-only (DOM + Blob). */
export function downloadDrawingPreview(preview: Pick<DrawingPreview, 'svg' | 'fileName'>): void {
  const blob = new Blob([preview.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = preview.fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
