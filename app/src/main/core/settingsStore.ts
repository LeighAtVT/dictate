// Settings has no Swift counterpart (v1 used UserDefaults); this is a new
// JSON-file-backed store for v2. Defaults and shape are the task-8 brief's.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { atomicWrite } from './atomicWrite'
import { defaultSettings, type Settings } from './settings'

export { defaultSettings, type Settings } from './settings'

export declare interface SettingsStore {
  on(event: 'change', listener: (settings: Settings, changed: (keyof Settings)[]) => void): this
  emit(event: 'change', settings: Settings, changed: (keyof Settings)[]): boolean
}

export class SettingsStore extends EventEmitter {
  private readonly file: string
  private settings: Settings

  constructor(file: string) {
    super()
    this.file = file
    this.settings = this.load()
  }

  get(): Settings {
    return this.settings
  }

  set(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter(
      (key) => JSON.stringify(this.settings[key]) !== JSON.stringify(patch[key])
    )
    if (changed.length === 0) return
    this.settings = { ...this.settings, ...patch }
    this.writeAtomic()
    this.emit('change', this.settings, changed)
  }

  private load(): Settings {
    const defaults = defaultSettings()
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return defaults
    }
    try {
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed }
    } catch {
      try {
        fs.renameSync(this.file, `${this.file}.bad`)
      } catch {
        // best effort; fall through to defaults either way
      }
      return defaults
    }
  }

  private writeAtomic(): void {
    atomicWrite(this.file, JSON.stringify(this.settings, null, 2))
  }
}
