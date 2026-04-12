import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IfcUpload } from './IfcUpload'

function makeIfc(name = 'model.ifc', size = 1024): File {
  return new File([new ArrayBuffer(size)], name, { type: '' })
}

describe('IfcUpload', () => {
  it('renders the upload zone', () => {
    render(<IfcUpload onFileAccepted={vi.fn()} isLoading={false} error={null} />)
    expect(screen.getByRole('button', { name: /upload ifc/i })).toBeInTheDocument()
  })

  it('shows a spinner while loading', () => {
    render(<IfcUpload onFileAccepted={vi.fn()} isLoading={true} error={null} />)
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument()
  })

  it('displays an external error message', () => {
    render(<IfcUpload onFileAccepted={vi.fn()} isLoading={false} error="Parse failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Parse failed')
  })

  it('calls onFileAccepted for a valid .ifc file via input', async () => {
    const onFileAccepted = vi.fn()
    render(<IfcUpload onFileAccepted={onFileAccepted} isLoading={false} error={null} />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, makeIfc('building.ifc'))

    expect(onFileAccepted).toHaveBeenCalledWith(expect.objectContaining({ name: 'building.ifc' }))
  })

  it('shows a local error and does not call onFileAccepted for a non-IFC file', () => {
    const onFileAccepted = vi.fn()
    render(<IfcUpload onFileAccepted={onFileAccepted} isLoading={false} error={null} />)

    fireEvent.drop(screen.getByRole('button', { name: /upload ifc/i }), {
      dataTransfer: {
        files: [new File(['data'], 'model.rvt')],
      },
    })

    expect(onFileAccepted).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Only .ifc/)
  })

  it('shows an error for an empty file', async () => {
    const onFileAccepted = vi.fn()
    render(<IfcUpload onFileAccepted={onFileAccepted} isLoading={false} error={null} />)

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.upload(input, makeIfc('model.ifc', 0))

    expect(onFileAccepted).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/empty/)
  })
})
