import { describe, it, expect } from 'vitest'
import { validateFile, FILE_TOO_LARGE_MESSAGE, MAX_FILE_SIZE } from './validateFile'

function makeFile(name: string, size: number): File {
  return new File([new ArrayBuffer(size)], name)
}

describe('validateFile', () => {
  it('accepts a valid .ifc file', () => {
    expect(validateFile(makeFile('model.ifc', 1024))).toBeNull()
  })

  it('accepts uppercase .IFC extension', () => {
    expect(validateFile(makeFile('MODEL.IFC', 1024))).toBeNull()
  })

  it('rejects a non-IFC file', () => {
    expect(validateFile(makeFile('model.rvt', 1024))).toMatch(/Only .ifc/)
  })

  it('rejects a file with no extension', () => {
    expect(validateFile(makeFile('model', 1024))).toMatch(/Only .ifc/)
  })

  it('rejects an empty file', () => {
    expect(validateFile(makeFile('model.ifc', 0))).toMatch(/empty/)
  })

  it('rejects a file exceeding 500 MB with linked-file guidance', () => {
    const message = validateFile(makeFile('model.ifc', MAX_FILE_SIZE + 1))
    expect(message).toMatch(/500 MB/)
    expect(message).toMatch(/export linked files as separate IFCs/i)
    expect(message).toBe(FILE_TOO_LARGE_MESSAGE)
  })

  it('accepts a file exactly at the size limit', () => {
    expect(validateFile(makeFile('model.ifc', MAX_FILE_SIZE))).toBeNull()
  })
})
