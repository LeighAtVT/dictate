// Task 13: the preview's first launch copies v1's data (spec 2.4). v1's folder is only ever read:
// these tests check its mtimes and also run it read-only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeEngine, waitUntil } from './core/pipelineFakes'
import { DEFAULT_CLEANUP, DEFAULT_EDIT } from './core/modelCatalog'
import {
  MARKER_FILE,
  MODEL_FILE,
  copyV1Data,
  migrateFromV1,
  parseV1Defaults,
  readV1Defaults,
  settingsFromV1Defaults
} from './migrate'

const KEY = 'sk-or-v1-test-key-never-logged'
const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

/** What `defaults export com.leigh.dictate -` gives on this Mac, parsed. */
const v1Defaults = (): Record<string, unknown> => ({
  cleanupModel: json({ thinking: 'off', id: 'deepseek/deepseek-v4.1-flash' }),
  editModel: json({ id: 'openai/gpt-6-luna', thinking: 'modelDefault' }),
  polishModel: 'anthropic/claude-haiku-5.5',
  styleOverrides: { 'com.tinyspeck.slackmacgap': 'email', 'com.bad': 'nonsense' },
  hotkey: 'rightOption',
  spokenLanguage: 'es',
  pasteLanguage: 'en'
})

let root: string
let v1Dir: string
let dataDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dictate-migrate-'))
  v1Dir = path.join(root, 'Dictate')
  dataDir = path.join(root, 'Dictate Preview')
  fs.mkdirSync(path.join(v1Dir, 'models'), { recursive: true })
  fs.writeFileSync(path.join(v1Dir, 'vocabulary.txt'), 'Zephyr\nAcme\n')
  fs.writeFileSync(path.join(v1Dir, 'shortcuts.json'), JSON.stringify([{ id: 'a', phrase: 'sig', text: 'Thanks' }]))
  fs.writeFileSync(
    path.join(v1Dir, 'history.json'),
    JSON.stringify([{ date: '2026-10-21T10:00:00Z', bundleID: 'com.apple.TextEdit', raw: 'v1 raw', final: 'v1 final' }])
  )
  fs.writeFileSync(path.join(v1Dir, MODEL_FILE), 'model bytes')
})

afterEach(() => {
  makeWritable(root)
  fs.rmSync(root, { recursive: true, force: true })
})

function makeWritable(dir: string): void {
  if (!fs.existsSync(dir)) return
  fs.chmodSync(dir, 0o755)
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.lstatSync(p).isDirectory()) makeWritable(p)
    else fs.chmodSync(p, 0o644)
  }
}

function makeReadOnly(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.lstatSync(p).isDirectory()) makeReadOnly(p)
    else fs.chmodSync(p, 0o444)
  }
  fs.chmodSync(dir, 0o555)
}

/** Every path under `dir` with its mtime and size, to prove nothing in it changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    const s = fs.statSync(d)
    out[path.relative(dir, d) || '.'] = `${s.mtimeMs}:${s.size}`
    if (!s.isDirectory()) return
    for (const name of fs.readdirSync(d)) walk(path.join(d, name))
  }
  walk(dir)
  return out
}

function keyEngine(key: string | null = KEY, previewKey: string | null = null): FakeEngine {
  const engine = new FakeEngine()
  engine.setReply('secret.get', { value: previewKey })
  engine.setReply('legacyKey', { key })
  engine.setReply('secret.set', {})
  return engine
}

const readDefaults = (d: Record<string, unknown> | null = v1Defaults()) => async () => d

const marker = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(dataDir, MARKER_FILE), 'utf8'))

const settingsFile = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))

describe('migrateFromV1', () => {
  it('copies the files, links the model, maps the defaults, and moves the key once', async () => {
    const engine = keyEngine()
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })

    expect(report.status).toBe('migrated')
    for (const name of ['vocabulary.txt', 'shortcuts.json', 'history.json']) {
      expect(fs.readFileSync(path.join(dataDir, name), 'utf8')).toBe(fs.readFileSync(path.join(v1Dir, name), 'utf8'))
    }
    // Hard link: same file on disk, no second copy of the model.
    const src = fs.statSync(path.join(v1Dir, MODEL_FILE))
    const dest = fs.statSync(path.join(dataDir, MODEL_FILE))
    expect(dest.ino).toBe(src.ino)
    expect(dest.dev).toBe(src.dev)

    expect(settingsFile()).toMatchObject({
      hotkey: 'rightOption',
      overrides: { 'com.tinyspeck.slackmacgap': 'email' },
      cleanupModel: { id: 'deepseek/deepseek-v4.1-flash', thinking: 'off' },
      editModel: { id: 'openai/gpt-6-luna', thinking: 'modelDefault' },
      spokenLanguage: 'es',
      pasteLanguage: 'en'
    })

    // The preview's own item first (no prompt), then v1's item once, then save it.
    expect(engine.calls.map((c) => c.op)).toEqual(['secret.get', 'legacyKey', 'secret.set'])
    expect(engine.callsFor('secret.set')).toEqual([{ op: 'secret.set', value: KEY }])
    expect(report).toMatchObject({
      status: 'migrated',
      copied: ['vocabulary.txt', 'shortcuts.json', 'history.json'],
      model: 'linked',
      key: 'imported'
    })
    expect(marker().key).toBe('imported')
  })

  it("writes the marker as key 'pending' once the files are in place, before the Keychain prompt", async () => {
    const engine = keyEngine()
    const release = engine.suspend('legacyKey')
    const running = migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    await waitUntil(() => engine.callsFor('legacyKey').length === 1)
    expect(marker().key).toBe('pending')
    expect(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')).toContain('v1 final')
    release()
    expect(await running).toMatchObject({ key: 'imported' })
    expect(marker().key).toBe('imported')
  })

  it("doesn't prompt when the preview already has its own key", async () => {
    const engine = keyEngine(KEY, 'sk-already-saved')
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    expect(report).toMatchObject({ status: 'migrated', key: 'imported' })
    expect(engine.calls.map((c) => c.op)).toEqual(['secret.get'])
    expect(marker().key).toBe('imported')
  })

  it('does nothing on a second run', async () => {
    await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    fs.writeFileSync(path.join(dataDir, 'history.json'), '[]') // the preview's own use since
    let defaultsRead = false
    const engine = keyEngine()

    const report = await migrateFromV1({
      v1Dir,
      dataDir,
      readDefaults: async () => {
        defaultsRead = true
        return v1Defaults()
      },
      engine
    })

    expect(report).toEqual({ status: 'alreadyMigrated' })
    expect(defaultsRead).toBe(false)
    expect(engine.calls).toEqual([])
    expect(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')).toBe('[]')
  })

  it("leaves v1's folder untouched (mtimes and sizes)", async () => {
    const before = snapshot(v1Dir)
    await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(snapshot(v1Dir)).toEqual(before)
    expect(fs.readdirSync(v1Dir).sort()).toEqual(['history.json', 'models', 'shortcuts.json', 'vocabulary.txt'])
  })

  it("works with v1's folder read-only, so it never needs to write there", async () => {
    makeReadOnly(v1Dir)
    const before = snapshot(v1Dir)
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(report.status).toBe('migrated')
    expect(fs.statSync(path.join(dataDir, MODEL_FILE)).ino).toBe(fs.statSync(path.join(v1Dir, MODEL_FILE)).ino)
    expect(snapshot(v1Dir)).toEqual(before)
  })

  it("lets v1's data win over the preview's test leftovers", async () => {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'history.json'), '[{"leftover":true}]')
    fs.writeFileSync(path.join(dataDir, 'vocabulary.txt'), 'Leftover\n')
    fs.writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({ hotkey: 'leftControl', cleanupModel: { id: 'bad/test-model', thinking: 'off' }, keepHistory: false })
    )
    await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')).toContain('v1 final')
    expect(fs.readFileSync(path.join(dataDir, 'vocabulary.txt'), 'utf8')).toBe('Zephyr\nAcme\n')
    // Mapped keys are v1's; keys v1 never had (keepHistory) keep the preview's value.
    expect(settingsFile()).toMatchObject({
      hotkey: 'rightOption',
      cleanupModel: { id: 'deepseek/deepseek-v4.1-flash', thinking: 'off' },
      keepHistory: false
    })
  })

  it('replaces a different model file at the destination with the link', async () => {
    fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, MODEL_FILE), 'partial download')
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(report).toMatchObject({ model: 'linked' })
    expect(fs.statSync(path.join(dataDir, MODEL_FILE)).ino).toBe(fs.statSync(path.join(v1Dir, MODEL_FILE)).ino)
  })

  it('leaves no temporary model file behind, even after an interrupted earlier try', async () => {
    fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, `${MODEL_FILE}.migrating`), 'left by a killed launch')
    await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(fs.readdirSync(path.join(dataDir, 'models'))).toEqual(['ggml-large-v3-turbo-q5_0.bin'])
  })

  it('skips the model when the destination is already the same file', async () => {
    fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true })
    fs.linkSync(path.join(v1Dir, MODEL_FILE), path.join(dataDir, MODEL_FILE))
    let linked = false
    const report = await migrateFromV1({
      v1Dir,
      dataDir,
      readDefaults: readDefaults(),
      engine: keyEngine(),
      link: () => {
        linked = true
      }
    })
    expect(report).toMatchObject({ model: 'alreadyLinked' })
    expect(linked).toBe(false)
  })

  it('copies the model when the folders are on different volumes (EXDEV)', async () => {
    const report = await migrateFromV1({
      v1Dir,
      dataDir,
      readDefaults: readDefaults(),
      engine: keyEngine(),
      link: () => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      }
    })
    expect(report).toMatchObject({ status: 'migrated', model: 'copied' })
    expect(fs.readFileSync(path.join(dataDir, MODEL_FILE), 'utf8')).toBe('model bytes')
    expect(fs.statSync(path.join(dataDir, MODEL_FILE)).ino).not.toBe(fs.statSync(path.join(v1Dir, MODEL_FILE)).ino)
  })

  it('treats a missing v1 file as nothing to copy, not an error', async () => {
    fs.rmSync(path.join(v1Dir, 'shortcuts.json'))
    fs.rmSync(path.join(v1Dir, MODEL_FILE))
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(report).toMatchObject({ status: 'migrated', copied: ['vocabulary.txt', 'history.json'], model: 'missing' })
    expect(fs.existsSync(path.join(dataDir, 'shortcuts.json'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, MARKER_FILE))).toBe(true)
  })

  it('handles no v1 at all: no folder, no preferences', async () => {
    fs.rmSync(v1Dir, { recursive: true })
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(null), engine: keyEngine(null) })
    expect(report).toMatchObject({ status: 'migrated', copied: [], model: 'missing', settings: [], key: 'none' })
    expect(fs.existsSync(path.join(dataDir, 'settings.json'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, MARKER_FILE))).toBe(true)
  })

  it("doesn't write the marker when a file step fails, so the next launch retries", async () => {
    const engine = keyEngine()
    const report = await migrateFromV1({
      v1Dir,
      dataDir,
      readDefaults: async () => {
        throw new Error('defaults failed')
      },
      engine
    })
    expect(report).toEqual({ status: 'failed', error: 'defaults failed' })
    expect(fs.existsSync(path.join(dataDir, MARKER_FILE))).toBe(false)
    expect(engine.calls).toEqual([]) // no Keychain prompt for a migration that will run again
  })

  it("marks key 'none' when v1 has no key (or the prompt was denied), and never asks again", async () => {
    const engine = keyEngine(null)
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    expect(report).toMatchObject({ status: 'migrated', key: 'none' })
    expect(engine.callsFor('legacyKey')).toHaveLength(1)
    expect(engine.callsFor('secret.set')).toEqual([])
    expect(marker().key).toBe('none')

    const again = keyEngine()
    await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: again })
    expect(again.calls).toEqual([])
  })

  it('treats a blank key like no key', async () => {
    const engine = keyEngine('   \n')
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    expect(report).toMatchObject({ key: 'none' })
    expect(engine.callsFor('secret.set')).toEqual([])
  })

  it("marks key 'pending' when the engine goes away during the prompt, and the next launch retries only the key", async () => {
    const engine = keyEngine()
    engine.setError('legacyKey', new Error('engine process exited before replying'))
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    expect(report).toMatchObject({ status: 'migrated', key: 'pending' })
    expect(engine.callsFor('secret.set')).toEqual([])
    expect(marker().key).toBe('pending')

    // The preview's own use since; a key retry must not copy v1's files again.
    fs.writeFileSync(path.join(dataDir, 'history.json'), '[]')
    let defaultsRead = false
    const again = keyEngine()
    const retry = await migrateFromV1({
      v1Dir,
      dataDir,
      readDefaults: async () => {
        defaultsRead = true
        return v1Defaults()
      },
      engine: again
    })
    expect(retry).toEqual({ status: 'keyRetried', key: 'imported' })
    expect(again.calls.map((c) => c.op)).toEqual(['secret.get', 'legacyKey', 'secret.set'])
    expect(defaultsRead).toBe(false)
    expect(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')).toBe('[]')
    expect(marker()).toMatchObject({ key: 'imported', copied: ['vocabulary.txt', 'shortcuts.json', 'history.json'] })

    // Done now: a third launch does nothing.
    const third = keyEngine()
    expect(await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: third })).toEqual({
      status: 'alreadyMigrated'
    })
    expect(third.calls).toEqual([])
  })

  it("marks key 'pending' when reading the preview's own item fails", async () => {
    const engine = keyEngine()
    engine.setError('secret.get', new Error('engine process exited before replying'))
    expect(await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })).toMatchObject({ key: 'pending' })
    expect(engine.callsFor('legacyKey')).toEqual([])
  })

  it("marks key 'pending' when saving the key fails", async () => {
    const engine = keyEngine()
    engine.setError('secret.set', new Error('keychain write failed'))
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine })
    expect(report).toMatchObject({ status: 'migrated', key: 'pending' })
    expect(marker().key).toBe('pending')
  })

  it('never puts the key in the report or the marker', async () => {
    const report = await migrateFromV1({ v1Dir, dataDir, readDefaults: readDefaults(), engine: keyEngine() })
    expect(JSON.stringify(report)).not.toContain(KEY)
    expect(fs.readFileSync(path.join(dataDir, MARKER_FILE), 'utf8')).not.toContain(KEY)
  })

  it("refuses a data folder inside v1's folder, writing nothing", async () => {
    const inside = path.join(v1Dir, 'nested')
    const before = snapshot(v1Dir)
    const engine = keyEngine()
    const report = await migrateFromV1({ v1Dir, dataDir: inside, readDefaults: readDefaults(), engine })
    expect(report.status).toBe('failed')
    expect(snapshot(v1Dir)).toEqual(before)
    expect(engine.calls).toEqual([])
    const same = await migrateFromV1({ v1Dir, dataDir: v1Dir, readDefaults: readDefaults(), engine })
    expect(same.status).toBe('failed')
    expect(snapshot(v1Dir)).toEqual(before)
  })
})

describe('copyV1Data', () => {
  it("puts v1's files in place and marks the key step pending, without the engine", async () => {
    const step = await copyV1Data({ v1Dir, dataDir, readDefaults: readDefaults() })
    expect(step.status).toBe('copied')
    expect(fs.existsSync(path.join(dataDir, 'history.json'))).toBe(true)
    expect(marker().key).toBe('pending')
  })

  it("returns keyPending, copying nothing, when only the key step is left", async () => {
    await copyV1Data({ v1Dir, dataDir, readDefaults: readDefaults() })
    fs.writeFileSync(path.join(dataDir, 'history.json'), '[]')
    expect(await copyV1Data({ v1Dir, dataDir, readDefaults: readDefaults() })).toEqual({ status: 'keyPending' })
    expect(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8')).toBe('[]')
  })
})

describe('settingsFromV1Defaults (AppSettings.init)', () => {
  it("maps v1's keys and plist data", () => {
    expect(settingsFromV1Defaults(v1Defaults())).toEqual({
      hotkey: 'rightOption',
      overrides: { 'com.tinyspeck.slackmacgap': 'email' },
      cleanupModel: { id: 'deepseek/deepseek-v4.1-flash', thinking: 'off' },
      editModel: { id: 'openai/gpt-6-luna', thinking: 'modelDefault' },
      spokenLanguage: 'es',
      pasteLanguage: 'en'
    })
  })

  it("uses v1's defaults for keys it never saved", () => {
    expect(settingsFromV1Defaults({ polishModel: 'anthropic/claude-haiku-5.5' })).toEqual({
      hotkey: 'fn',
      overrides: {},
      cleanupModel: DEFAULT_CLEANUP,
      editModel: DEFAULT_EDIT,
      spokenLanguage: 'en',
      pasteLanguage: 'same'
    })
  })

  it('migrates a typed legacy polishModel to a custom cleanup model (migrateLegacy)', () => {
    expect(settingsFromV1Defaults({ polishModel: '  acme/zephyr-1  ' }).cleanupModel).toEqual({
      id: 'acme/zephyr-1',
      thinking: 'modelDefault'
    })
  })

  it('falls back like Swift Codable when the stored model data is unreadable', () => {
    const d = {
      cleanupModel: new TextEncoder().encode('not json'),
      editModel: json({ id: 'x/y', thinking: 'turbo' }), // not a Thinking value
      polishModel: 'acme/zephyr-1',
      hotkey: 'capsLock' // not a v1 Hotkey
    }
    expect(settingsFromV1Defaults(d)).toMatchObject({
      cleanupModel: { id: 'acme/zephyr-1', thinking: 'modelDefault' },
      editModel: DEFAULT_EDIT,
      hotkey: 'fn'
    })
  })
})

describe('reading v1 preferences', () => {
  const exported = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>cleanupModel</key>
	<data>
	eyJ0aGlua2luZyI6Im1pbmltYWwiLCJpZCI6InotYWlcL2dsbS01LjMtZmxhc2gifQ==
	</data>
	<key>polishModel</key>
	<string>anthropic/claude-haiku-5.5</string>
	<key>styleOverrides</key>
	<dict/>
</dict>
</plist>`

  it('parses `defaults export` output, including <data> holding JSON', () => {
    const d = parseV1Defaults(exported)
    expect(d).not.toBeNull()
    expect(settingsFromV1Defaults(d!).cleanupModel).toEqual({ id: 'z-ai/glm-5.3-flash', thinking: 'minimal' })
  })

  it('reads an empty domain (no v1 preferences) as null', () => {
    expect(parseV1Defaults('<?xml version="1.0"?><plist version="1.0"><dict/></plist>')).toBeNull()
  })

  it('runs `defaults export com.leigh.dictate -` and only reads', async () => {
    const calls: [string, string[]][] = []
    const d = await readV1Defaults(async (file, args) => {
      calls.push([file, args])
      return { code: 0, stdout: exported }
    })
    expect(calls).toEqual([['/usr/bin/defaults', ['export', 'com.leigh.dictate', '-']]])
    expect(d).toHaveProperty('polishModel', 'anthropic/claude-haiku-5.5')
  })

  it('fails (so the migration retries) when `defaults` fails', async () => {
    await expect(readV1Defaults(async () => ({ code: 1, stdout: '' }))).rejects.toThrow()
  })
})
