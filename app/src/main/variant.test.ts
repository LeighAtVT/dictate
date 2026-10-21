import { describe, expect, it } from 'vitest'
import { variantFor } from './variant'

const HOME = '/Users/someone'

describe('variantFor', () => {
  it('derives the preview from "Dictate Preview"', () => {
    expect(variantFor('Dictate Preview', HOME)).toEqual({
      name: 'Dictate Preview',
      bundleId: 'com.leigh.dictate.preview',
      dataDir: '/Users/someone/Library/Application Support/Dictate Preview',
      logFile: '/Users/someone/Library/Logs/Dictate Preview/dictate.log',
      agentLabel: 'com.leigh.dictate.preview.keepalive',
      keychainService: 'com.leigh.dictate.preview',
      isFinal: false
    })
  })

  it('derives the final build only from exactly "Dictate"', () => {
    expect(variantFor('Dictate', HOME)).toEqual({
      name: 'Dictate',
      bundleId: 'com.leigh.dictate',
      dataDir: '/Users/someone/Library/Application Support/Dictate',
      logFile: '/Users/someone/Library/Logs/Dictate/dictate.log',
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
