// Settings has no Swift counterpart (v1 used UserDefaults); these are the
// task-8 brief's added cases: round trip, corrupt file -> defaults + .bad,
// and a change event that lists only the changed keys.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLEANUP_PRESETS, EDIT_PRESETS } from './modelCatalog'
import { SettingsStore, defaultSettings } from './settingsStore'

describe('SettingsStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-settings-'))
    file = path.join(dir, 'settings.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('gives defaults when the file is missing', () => {
    const store = new SettingsStore(file)
    expect(store.get()).toEqual({
      hotkey: 'fn',
      overrides: {},
      cleanupModel: CLEANUP_PRESETS[0].choice,
      editModel: EDIT_PRESETS[0].choice,
      spokenLanguage: 'en',
      pasteLanguage: 'same',
      keepHistory: true
    })
    expect(defaultSettings()).toEqual(store.get())
  })

  it('round trips through set() and a fresh instance', () => {
    const store = new SettingsStore(file)
    store.set({ hotkey: 'capsLock', keepHistory: false })
    expect(fs.existsSync(file)).toBe(true)

    const reloaded = new SettingsStore(file)
    expect(reloaded.get().hotkey).toBe('capsLock')
    expect(reloaded.get().keepHistory).toBe(false)
    // unrelated defaults survive the round trip
    expect(reloaded.get().spokenLanguage).toBe('en')
  })

  it('writes atomically (temp file is gone, target file holds the write)', () => {
    const store = new SettingsStore(file)
    store.set({ hotkey: 'capsLock' })
    const siblings = fs.readdirSync(dir)
    expect(siblings).toEqual(['settings.json'])
  })

  it('gives defaults and keeps the corrupt file as settings.json.bad', () => {
    fs.writeFileSync(file, '{ not valid json')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings())
    expect(fs.existsSync(`${file}.bad`)).toBe(true)
    expect(fs.readFileSync(`${file}.bad`, 'utf8')).toBe('{ not valid json')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('emits a change event listing only the changed keys', () => {
    const store = new SettingsStore(file)
    const seen: Array<[string, (keyof ReturnType<typeof defaultSettings>)[]]> = []
    store.on('change', (settings, changed) => {
      seen.push([settings.hotkey, changed])
    })
    // spokenLanguage matches the default, so only hotkey should be reported changed.
    store.set({ hotkey: 'capsLock', spokenLanguage: 'en' })
    expect(seen).toEqual([['capsLock', ['hotkey']]])
  })

  it('does not emit when set() changes nothing', () => {
    const store = new SettingsStore(file)
    let calls = 0
    store.on('change', () => {
      calls++
    })
    store.set({ hotkey: 'fn' })
    expect(calls).toBe(0)
  })
})
