/// <reference types="vite/client" />
import type { DictateApi } from '../shared/dictate'

declare global {
  interface Window {
    /** From src/preload/index.ts, in the Settings and Onboarding windows only. */
    dictate: DictateApi
  }
}
