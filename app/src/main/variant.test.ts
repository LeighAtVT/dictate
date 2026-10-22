import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { variantFor } from './variant'

const HOME = '/Users/someone'
// '/Users/someone/Library/…' on a Mac; built with path.join so the brain tests also pass on Windows.
const under = (...parts: string[]): string => path.join(HOME, ...parts)

describe('variantFor', () => {
  it('derives the preview from "Dictate Preview"', () => {
    expect(variantFor('Dictate Preview', HOME)).toEqual({
      name: 'Dictate Preview',
      bundleId: 'com.leigh.dictate.preview',
      dataDir: under('Library', 'Application Support', 'Dictate Preview'),
      logFile: under('Library', 'Logs', 'Dictate Preview', 'dictate.log'),
      agentLabel: 'com.leigh.dictate.preview.keepalive',
      keychainService: 'com.leigh.dictate.preview',
      isFinal: false
    })
  })

  it('derives the final build only from exactly "Dictate"', () => {
    expect(variantFor('Dictate', HOME)).toEqual({
      name: 'Dictate',
      bundleId: 'com.leigh.dictate',
      dataDir: under('Library', 'Application Support', 'Dictate'),
      logFile: under('Library', 'Logs', 'Dictate', 'dictate.log'),
      agentLabel: 'com.leigh.dictate.keepalive',
      keychainService: 'com.leigh.dictate',
      isFinal: true
    })
  })

  it('treats any other name (e.g. the package name in dev) as the preview', () => {
    for (const name of ['dictate-preview', 'dictate', 'Electron', '']) {
      const v = variantFor(name, HOME)
      expect(v.isFinal).toBe(false)
      expect(v.name).toBe('Dictate Preview')
      expect(v.keychainService).toBe('com.leigh.dictate.preview')
    }
  })
})
