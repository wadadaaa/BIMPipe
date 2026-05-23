/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEMO_MODE?: string
  readonly DEMO_CONFIG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
