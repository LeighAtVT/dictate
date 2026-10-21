import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'

// Dictate v2 Mac Preview, Task 1: proves Electron can spawn a signed Swift engine
// that shares the app's macOS permissions (see the design spec, section 4 — the
// spike-only status polling, recording, tray item, file trigger, and disk logging
// that proved this were removed once the spike passed). The real engine protocol
// (JSON-line requests/events, spec section 2.3) is built in a later task; this is
// just the spawn-and-forward plumbing it will build on.

let engine: ChildProcessWithoutNullStreams | null = null

/** Packaged layout: Contents/Resources (resourcesPath) and Contents/MacOS are siblings. */
function engineBinaryPath(): string {
  return join(process.resourcesPath, '..', 'MacOS', 'dictate-engine')
}

function spawnEngine(): void {
  const binPath = engineBinaryPath()
  console.log(`spawning engine: ${binPath}`)
  const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  engine = child

  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > 0) console.log(`engine: ${line}`)
      newlineIndex = buffer.indexOf('\n')
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    console.error(`engine stderr: ${chunk.toString('utf8').trim()}`)
  })
  child.on('exit', (code, signal) => {
    console.log(`engine exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    engine = null
  })
  child.on('error', (error) => {
    console.error(`engine spawn error: ${error.message}`)
  })
}

app.whenReady().then(() => {
  spawnEngine()
})

// Menu-bar only app (LSUIElement): there is no window to close, so never quit on that account.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  engine?.kill()
})
