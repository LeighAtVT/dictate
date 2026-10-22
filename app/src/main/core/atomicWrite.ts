// Shared by settingsStore.ts, history.ts, fileStores.ts, and runJournal.ts:
// write a temp file in the same directory, then rename it over the target so
// a reader never sees a partial write. Creates missing parent directories.
import fs from 'node:fs'
import path from 'node:path'

export function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}
