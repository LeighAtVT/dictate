import { defineConfig } from 'vitest/config'

// Brain-side unit tests (protocol, and future pure-TS logic) run in Node,
// not a browser/DOM environment; nothing here touches Electron APIs.
export default defineConfig({
  test: {
    environment: 'node'
  }
})
