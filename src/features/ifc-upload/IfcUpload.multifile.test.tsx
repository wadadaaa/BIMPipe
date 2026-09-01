import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IfcUpload } from './IfcUpload'

function makeIfc(name: string, size = 1024): File {
  return new File([new ArrayBuffer(size)], name, { type: '' })
}

describe('IfcUpload multi-file selection', () => {
  it('delivers a multi-file pick through onFilesAccepted in selection order (first = host)', async () => {
    const onFileAccepted = vi.fn()
    const onFilesAccepted = vi.fn()
    render(
      <IfcUpload
        onFileAccepted={onFileAccepted}
        onFilesAccepted={onFilesAccepted}
        isLoading={false}
        error={null}
      />,
    )

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(input).toHaveAttribute('multiple')
    await userEvent.upload(input, [makeIfc('host-p.ifc'), makeIfc('linked-a.ifc')])

    expect(onFilesAccepted).toHaveBeenCalledTimes(1)
    const files = onFilesAccepted.mock.calls[0][0] as File[]
    expect(files.map((file) => file.name)).toEqual(['host-p.ifc', 'linked-a.ifc'])
    expect(onFileAccepted).not.toHaveBeenCalled()
  })

  it('keeps single-file picks on the legacy onFileAccepted path', async () => {
    const onFileAccepted = vi.fn()
    const onFilesAccepted = vi.fn()
    render(
      <IfcUpload
        onFileAccepted={onFileAccepted}
        onFilesAccepted={onFilesAccepted}
        isLoading={false}
        error={null}
      />,
    )

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, makeIfc('single.ifc'))

    expect(onFileAccepted).toHaveBeenCalledWith(expect.objectContaining({ name: 'single.ifc' }))
    expect(onFilesAccepted).not.toHaveBeenCalled()
  })

  it('accepts multiple dropped files', () => {
    const onFilesAccepted = vi.fn()
    render(
      <IfcUpload
        onFileAccepted={vi.fn()}
        onFilesAccepted={onFilesAccepted}
        isLoading={false}
        error={null}
      />,
    )

    fireEvent.drop(screen.getByRole('button', { name: /upload ifc/i }), {
      dataTransfer: { files: [makeIfc('host-p.ifc'), makeIfc('linked-a.ifc')] },
    })

    expect(onFilesAccepted).toHaveBeenCalledTimes(1)
  })

  it('rejects the whole multi-file selection naming the offending file', () => {
    const onFileAccepted = vi.fn()
    const onFilesAccepted = vi.fn()
    render(
      <IfcUpload
        onFileAccepted={onFileAccepted}
        onFilesAccepted={onFilesAccepted}
        isLoading={false}
        error={null}
      />,
    )

    fireEvent.drop(screen.getByRole('button', { name: /upload ifc/i }), {
      dataTransfer: { files: [makeIfc('host-p.ifc'), new File(['x'], 'model.rvt')] },
    })

    expect(onFilesAccepted).not.toHaveBeenCalled()
    expect(onFileAccepted).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('model.rvt: Only .ifc files are accepted.')
  })

  it('shows linked model names once provided', () => {
    render(
      <IfcUpload
        onFileAccepted={vi.fn()}
        isLoading={false}
        error={null}
        fileName="host-p.ifc"
        linkedFileNames={['linked-a.ifc']}
      />,
    )

    expect(screen.getByLabelText('Linked models')).toHaveTextContent('linked-a.ifc')
  })
})
