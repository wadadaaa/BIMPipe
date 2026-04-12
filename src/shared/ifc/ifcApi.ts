import type { IfcAPI } from 'web-ifc'

let instance: IfcAPI | null = null
let initPromise: Promise<IfcAPI> | null = null

/**
 * Returns the singleton IfcAPI, initialising the WASM runtime on first call.
 * Concurrent callers share the same init promise so only one IfcAPI is created.
 */
export async function getIfcApi(): Promise<IfcAPI> {
  if (instance) return instance
  if (initPromise) return initPromise

  initPromise = (async () => {
    const { IfcAPI } = await import('web-ifc')
    const api = new IfcAPI()
    api.SetWasmPath('/') // WASM files served from public/
    await api.Init()
    instance = api
    return api
  })()

  return initPromise
}
