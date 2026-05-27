import path from 'node:path'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const demoMode = env.DEMO_MODE === 'true'
  const demoConfigPath = env.DEMO_CONFIG || 'demo/adam-10/demo.config.json'

  let demoConfig: unknown = null

  if (demoMode) {
    if (!fs.existsSync(demoConfigPath)) {
      throw new Error(
        `DEMO_MODE=true but DEMO_CONFIG file was not found: ${demoConfigPath}. Add the config file and retry.`,
      )
    }

    try {
      demoConfig = JSON.parse(fs.readFileSync(demoConfigPath, 'utf-8'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error'
      throw new Error(`Failed to parse DEMO_CONFIG at ${demoConfigPath}: ${message}`)
    }

    const assetPath = (demoConfig as { model?: { assetPath?: unknown } }).model?.assetPath
    if (typeof assetPath !== 'string' || assetPath.trim() === '') {
      throw new Error(`DEMO_CONFIG is missing required model.assetPath in ${demoConfigPath}`)
    }

    if (!fs.existsSync(assetPath)) {
      console.warn(
        `[bimpipe demo] Demo model file was not found at ${assetPath}. Continuing build so demo users can upload ADAM_10.ifc manually.`,
      )
    }
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    define: {
      'import.meta.env.DEMO_MODE': JSON.stringify(demoMode),
      __BIMPIPE_DEMO_CONFIG__: JSON.stringify(demoConfig),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
