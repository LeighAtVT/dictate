import { describe, expect, it, vi } from 'vitest'
import { CHANNELS, type Permissions } from '../shared/dictate'
import { defaultSettings, type Settings } from './core/settings'
import type { HistoryEntry } from './core/history'
import { createHandlers, distinctBundleIDs, registerIpc, type IpcDeps } from './ipc'

function fakeDeps(): IpcDeps & { current: Settings } {
  const deps = {
    current: defaultSettings(),
    settings: {
      get: () => deps.current,
      set: vi.fn((patch: Partial<Settings>) => {
        deps.current = { ...deps.current, ...patch }
      })
    },
    saveKey: vi.fn(async (_key: string) => {}),
    removeKey: vi.fn(async () => {}),
    hasKey: vi.fn(async () => true),
    testModel: vi.fn(async () => ({ worked: 1 })),
    vocabulary: { get: vi.fn(() => ['Acme']), set: vi.fn() },
    shortcuts: { get: vi.fn(() => []), set: vi.fn() },
    knownApps: vi.fn(() => ['com.apple.TextEdit']),
    permissions: vi.fn(async (): Promise<Permissions> => ({ accessibility: true, microphone: 'granted' })),
    requestPermission: vi.fn(async () => {}),
    clearHistory: vi.fn(),
    openKeyboardSettings: vi.fn()
  }
  return deps
}

describe('setSettings validation', () => {
  const valid: Array<[string, Partial<Settings>]> = [
    ['hotkey', { hotkey: 'rightOption' }],
    ['overrides', { overrides: { 'com.tinyspeck.slackmacgap': 'raw', 'com.apple.mail': 'off' } }],
    ['empty overrides', { overrides: {} }],
    ['cleanupModel', { cleanupModel: { id: 'acme/model-1', thinking: 'modelDefault' } }],
    ['editModel', { editModel: { id: 'acme/model-2', thinking: 'low' } }],
    ['spokenLanguage auto', { spokenLanguage: 'auto' }],
    ['spokenLanguage es', { spokenLanguage: 'es' }],
    ['pasteLanguage same', { pasteLanguage: 'same' }],
    ['pasteLanguage en', { pasteLanguage: 'en' }],
    ['keepHistory', { keepHistory: false }],
    ['several keys', { hotkey: 'fn', keepHistory: true }]
  ]
  it.each(valid)('accepts %s', async (_name, patch) => {
    const deps = fakeDeps()
    await createHandlers(deps)[CHANNELS.setSettings](patch)
    expect(deps.settings.set).toHaveBeenCalledWith(patch)
  })

  const invalid: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'hotkey'],
    ['an array', [{ hotkey: 'fn' }]],
    ['an unknown key', { apiKey: 'x' }],
    ['a prototype key', JSON.parse('{"__proto__": {"hotkey": "fn"}}')],
    ['an unknown hotkey', { hotkey: 'capsLock' }],
    ['an override that is not a style', { overrides: { 'com.apple.mail': 'loud' } }],
    ['an override with a blank bundle ID', { overrides: { '': 'raw' } }],
    ['overrides as an array', { overrides: ['raw'] }],
    ['an override for "__proto__"', { overrides: JSON.parse('{"__proto__": "raw"}') }],
    ['a model with a blank ID', { cleanupModel: { id: '   ', thinking: 'modelDefault' } }],
    ['a model with an unknown thinking level', { cleanupModel: { id: 'acme/m', thinking: 'max' } }],
    ['a model with extra fields', { editModel: { id: 'acme/m', thinking: 'off', key: 'x' } }],
    ['a model ID with a newline', { cleanupModel: { id: 'acme/m\nx', thinking: 'off' } }],
    ['a model ID over 200 characters', { cleanupModel: { id: 'a'.repeat(201), thinking: 'off' } }],
    ['an unknown spoken language', { spokenLanguage: 'xx' }],
    ['"same" as the spoken language', { spokenLanguage: 'same' }],
    ['"auto" as the paste language', { pasteLanguage: 'auto' }],
    ['keepHistory as a string', { keepHistory: 'yes' }]
  ]
  it.each(invalid)('rejects %s and changes nothing', async (_name, patch) => {
    const deps = fakeDeps()
    await expect(createHandlers(deps)[CHANNELS.setSettings](patch)).rejects.toThrow()
    expect(deps.settings.set).not.toHaveBeenCalled()
  })
})

describe('key handlers', () => {
  it('saveKey trims and saves, then reports hasKey', async () => {
    const deps = fakeDeps()
    expect(await createHandlers(deps)[CHANNELS.saveKey]('  sk-or-v1-abc123  ')).toBe(true)
    expect(deps.saveKey).toHaveBeenCalledWith('sk-or-v1-abc123')
    expect(deps.removeKey).not.toHaveBeenCalled()
  })

  it('saveKey with a blank key removes it (v1 saveKey(""))', async () => {
    const deps = fakeDeps()
    deps.hasKey = vi.fn(async () => false)
    expect(await createHandlers(deps)[CHANNELS.saveKey]('   ')).toBe(false)
    expect(deps.removeKey).toHaveBeenCalledOnce()
    expect(deps.saveKey).not.toHaveBeenCalled()
  })

  it.each([
    ['a number', 42],
    ['a key with a space inside', 'sk-or abc'],
    ['a key with a newline inside', 'sk-or\nabc'],
    ['a key over 1000 characters', 'k'.repeat(1001)]
  ])('saveKey rejects %s without saving or echoing it', async (_name, key) => {
    const deps = fakeDeps()
    const result = createHandlers(deps)[CHANNELS.saveKey](key)
    await expect(result).rejects.toThrow()
    await result.catch((err: Error) => {
      if (typeof key === 'string') expect(err.message).not.toContain(key)
    })
    expect(deps.saveKey).not.toHaveBeenCalled()
    expect(deps.removeKey).not.toHaveBeenCalled()
  })

  it('hasKey returns only a boolean', async () => {
    const deps = fakeDeps()
    expect(await createHandlers(deps)[CHANNELS.hasKey]()).toBe(true)
  })
})

describe('testModel', () => {
  it('tests the choice with the saved key when no key is given', async () => {
    const deps = fakeDeps()
    const choice = { id: 'acme/m', thinking: 'modelDefault' }
    expect(await createHandlers(deps)[CHANNELS.testModel](choice)).toEqual({ worked: 1 })
    expect(deps.testModel).toHaveBeenCalledWith(choice, null)
  })

  it('tests with an unsaved key, trimmed', async () => {
    const deps = fakeDeps()
    const choice = { id: 'acme/m', thinking: 'off' }
    await createHandlers(deps)[CHANNELS.testModel](choice, ' sk-or-v1-new ')
    expect(deps.testModel).toHaveBeenCalledWith(choice, 'sk-or-v1-new')
  })

  it.each([
    ['no choice', [undefined]],
    ['a blank model ID', [{ id: '', thinking: 'off' }]],
    ['a bad thinking level', [{ id: 'acme/m', thinking: 'high' }]],
    ['a blank key', [{ id: 'acme/m', thinking: 'off' }, '  ']],
    ['a key that is not a string', [{ id: 'acme/m', thinking: 'off' }, 7]]
  ])('rejects %s', async (_name, args) => {
    const deps = fakeDeps()
    await expect(createHandlers(deps)[CHANNELS.testModel](...(args as unknown[]))).rejects.toThrow()
    expect(deps.testModel).not.toHaveBeenCalled()
  })
})

describe('vocabulary and shortcuts', () => {
  it('saves a list of terms', async () => {
    const deps = fakeDeps()
    await createHandlers(deps)[CHANNELS.setVocabulary](['Acme', 'Zephyr'])
    expect(deps.vocabulary.set).toHaveBeenCalledWith(['Acme', 'Zephyr'])
  })

  it.each([
    ['not an array', 'Acme'],
    ['a non-string term', ['Acme', 3]],
    ['a term over 500 characters', ['a'.repeat(501)]],
    ['a term with a newline inside', ['Acme\nZephyr']],
    ['a term with a carriage return', ['Acme\r']],
    ['over 10,000 terms', Array.from({ length: 10_001 }, () => 'a')]
  ])('rejects vocabulary that is %s', async (_name, terms) => {
    const deps = fakeDeps()
    await expect(createHandlers(deps)[CHANNELS.setVocabulary](terms)).rejects.toThrow()
    expect(deps.vocabulary.set).not.toHaveBeenCalled()
  })

  it('saves shortcuts, keeping only id, phrase and text', async () => {
    const deps = fakeDeps()
    await createHandlers(deps)[CHANNELS.setShortcuts]([{ id: 'a', phrase: 'my link', text: 'https://example.com', extra: 1 }])
    expect(deps.shortcuts.set).toHaveBeenCalledWith([{ id: 'a', phrase: 'my link', text: 'https://example.com' }])
  })

  it.each([
    ['not an array', { id: 'a', phrase: 'p', text: 't' }],
    ['missing text', [{ id: 'a', phrase: 'p' }]],
    ['a blank id', [{ id: '', phrase: 'p', text: 't' }]],
    ['a null entry', [null]],
    [
      'two with the same id',
      [
        { id: 'a', phrase: 'one', text: '1' },
        { id: 'a', phrase: 'two', text: '2' }
      ]
    ],
    ['text over 20,000 characters', [{ id: 'a', phrase: 'p', text: 't'.repeat(20_001) }]]
  ])('rejects shortcuts that are %s', async (_name, list) => {
    const deps = fakeDeps()
    await expect(createHandlers(deps)[CHANNELS.setShortcuts](list)).rejects.toThrow()
    expect(deps.shortcuts.set).not.toHaveBeenCalled()
  })
})

describe('permissions and the rest', () => {
  it.each(['microphone', 'accessibility'])('requests %s', async (name) => {
    const deps = fakeDeps()
    await createHandlers(deps)[CHANNELS.requestPermission](name)
    expect(deps.requestPermission).toHaveBeenCalledWith(name)
  })

  it.each([['camera'], [undefined], [{ name: 'microphone' }]])('rejects a request for %s', async (name) => {
    const deps = fakeDeps()
    await expect(createHandlers(deps)[CHANNELS.requestPermission](name)).rejects.toThrow()
    expect(deps.requestPermission).not.toHaveBeenCalled()
  })

  it('passes the no-argument calls through', async () => {
    const deps = fakeDeps()
    const handlers = createHandlers(deps)
    expect(await handlers[CHANNELS.getSettings]()).toEqual(defaultSettings())
    expect(await handlers[CHANNELS.getVocabulary]()).toEqual(['Acme'])
    expect(await handlers[CHANNELS.getShortcuts]()).toEqual([])
    expect(await handlers[CHANNELS.knownApps]()).toEqual(['com.apple.TextEdit'])
    expect(await handlers[CHANNELS.permissions]()).toEqual({ accessibility: true, microphone: 'granted' })
    await handlers[CHANNELS.clearHistory]()
    expect(deps.clearHistory).toHaveBeenCalledOnce()
    await handlers[CHANNELS.openKeyboardSettings]()
    expect(deps.openKeyboardSettings).toHaveBeenCalledOnce()
  })

  it('has a handler for every channel', () => {
    expect(Object.keys(createHandlers(fakeDeps())).sort()).toEqual(Object.values(CHANNELS).sort())
  })
})

describe('registerIpc', () => {
  function fakeIpcMain() {
    type Listener = (event: { sender: unknown }, ...args: unknown[]) => unknown
    const handlers = new Map<string, Listener>()
    return {
      handlers,
      handle: (channel: string, fn: Listener): void => {
        handlers.set(channel, fn)
      }
    }
  }

  it('registers every channel and passes the arguments after the event', async () => {
    const deps = fakeDeps()
    const ipc = fakeIpcMain()
    registerIpc(ipc, createHandlers(deps), () => true)
    expect([...ipc.handlers.keys()].sort()).toEqual(Object.values(CHANNELS).sort())
    await ipc.handlers.get(CHANNELS.setSettings)!({ sender: {} }, { keepHistory: false })
    expect(deps.settings.set).toHaveBeenCalledWith({ keepHistory: false })
  })

  it('refuses calls from any other window (the pill, say)', async () => {
    const deps = fakeDeps()
    const ipc = fakeIpcMain()
    const sender = { id: 9 }
    registerIpc(ipc, createHandlers(deps), (s) => s !== sender)
    await expect(Promise.resolve(ipc.handlers.get(CHANNELS.clearHistory)!({ sender }))).rejects.toThrow()
    expect(deps.clearHistory).not.toHaveBeenCalled()
  })
})

describe('distinctBundleIDs (knownApps)', () => {
  const entry = (bundleID: string, date = '2026-10-21T12:00:00Z'): HistoryEntry => ({ date, bundleID, raw: 'r', final: 'f' })

  it('lists each bundle ID once, in first-seen order, skipping blanks', () => {
    const entries = [entry('com.apple.TextEdit'), entry('com.tinyspeck.slackmacgap'), entry(''), entry('com.apple.TextEdit'), entry('note')]
    expect(distinctBundleIDs(entries)).toEqual(['com.apple.TextEdit', 'com.tinyspeck.slackmacgap', 'note'])
  })

  it('is empty for an empty history', () => {
    expect(distinctBundleIDs([])).toEqual([])
  })
})
