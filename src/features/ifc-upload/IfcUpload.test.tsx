import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  describe('sample model', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('downloads the sample with a busy state and feeds it through the accepted-file path', async () => {
      const onFileAccepted = vi.fn()
      let resolveFetch: (value: unknown) => void = () => {}
      const fetchMock = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      render(<IfcUpload onFileAccepted={onFileAccepted} isLoading={false} error={null} />)

      await userEvent.click(screen.getByRole('button', { name: /duplex mep/i }))

      // Busy state while the sample is downloading.
      expect(screen.getByRole('button', { name: /downloading duplex mep/i })).toBeDisabled()
      expect(fetchMock).toHaveBeenCalledWith('/samples/Duplex_MEP_20110907.ifc')

      resolveFetch({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(2048),
      })

      await waitFor(() => {
        expect(onFileAccepted).toHaveBeenCalledTimes(1)
      })
      const file = onFileAccepted.mock.calls[0][0] as File
      expect(file.name).toBe('Duplex_MEP_20110907.ifc')
      expect(file.size).toBe(2048)
      expect(screen.getByRole('button', { name: /duplex mep \(17 mb\)/i })).toBeEnabled()
    })

    it('surfaces a visible error with the reason when the sample download fails', async () => {
      const onFileAccepted = vi.fn()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404 })),
      )

      render(<IfcUpload onFileAccepted={onFileAccepted} isLoading={false} error={null} />)

      await userEvent.click(screen.getByRole('button', { name: /duplex mep/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Failed to download sample model 'Duplex_MEP_20110907.ifc': HTTP 404",
      )
      expect(onFileAccepted).not.toHaveBeenCalled()
    })

    it('hides the sample affordance when showSampleModel is false', () => {
      render(
        <IfcUpload
          onFileAccepted={vi.fn()}
          isLoading={false}
          error={null}
          showSampleModel={false}
        />,
      )
      expect(screen.queryByRole('button', { name: /duplex mep/i })).not.toBeInTheDocument()
    })

    it('hides the sample affordance once a model is loaded', () => {
      render(
        <IfcUpload onFileAccepted={vi.fn()} isLoading={false} error={null} fileName="tower.ifc" />,
      )
      expect(screen.queryByRole('button', { name: /duplex mep/i })).not.toBeInTheDocument()
    })
  })
})
