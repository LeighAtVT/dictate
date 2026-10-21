import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      // plist ships ESM only (an "import" export, no "require"), so the CommonJS main bundle
      // can't require it at run time: bundle it in instead.
      externalizeDeps: { exclude: ['plist'] }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          // Settings and Onboarding share this one; both are sandboxed, so neither preload may
          // require anything but 'electron' (no packages).
          index: resolve('src/preload/index.ts'),
          pill: resolve('src/preload/pill.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          settings: resolve('src/renderer/settings/index.html'),
          onboarding: resolve('src/renderer/onboarding/index.html'),
          pill: resolve('src/renderer/pill/index.html')
        }
      }
    }
  }
})
