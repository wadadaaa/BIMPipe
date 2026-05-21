/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEMO_MODE?: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
