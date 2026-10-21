// Dictate v2, Task 2: the JSON-lines protocol spoken between the Electron
// "brain" (this file) and the Swift "engine" (native/mac/EngineKit/Protocol.swift).
// Both sides are exercised against the same fixtures file
// (protocol-fixtures.json) so they can't drift apart. See the design spec,
// section 2.3, for the wire format.

export type Modifier = 'shift' | 'control' | 'alt' | 'command'
export type ModeAction = 'dictate' | 'edit' | 'note'

export type EngineEvent =
  | { event: 'key'; down: boolean; held: Modifier[] }
  | { event: 'modifiers'; held: Modifier[] }
  | { event: 'otherKey' }
  | { event: 'escape' }
  | { event: 'shortcut'; action: ModeAction }
  | { event: 'model'; state: 'downloading' | 'loading' | 'ready' | 'failed'; fraction?: number }
  | { event: 'log'; message: string }

export type EngineRequest =
  | { op: 'startRecording' }
  | { op: 'cancelRecording' }
  | { op: 'stopRecording'; language: string; vocabulary: string[] }
  | { op: 'context' }
  | { op: 'selection' }
  | { op: 'paste'; text: string }
  | { op: 'copy'; text: string }
  | { op: 'setHotkey'; key: string }
  | { op: 'permissions' }
  | { op: 'requestPermission'; name: 'microphone' | 'accessibility' }
  | { op: 'secret.get' }
  | { op: 'secret.set'; value: string }
  | { op: 'secret.delete' }
  | { op: 'legacyKey' }
  | { op: 'quit' }

export interface ReplyMap {
  startRecording: {}
  cancelRecording: {}
  copy: {}
  setHotkey: {}
  requestPermission: {}
  quit: {}
  stopRecording: { result: 'text' | 'noSpeech'; text?: string; seconds: number }
  context: { appId: string; windowTitle: string | null; secureInput: boolean; elevated: boolean }
  selection: { text: string | null }
  paste: { result: 'pasted' | 'copied' }
  permissions: { accessibility: boolean; microphone: 'granted' | 'denied' | 'undetermined' }
  'secret.get': { value: string | null }
  'secret.set': {}
  'secret.delete': {}
  legacyKey: { key: string | null }
}

/**
 * Encodes one request as a single JSON line, no trailing newline. Wire shape
 * is `{id, ...req}`: the request's own discriminated-union fields (including
 * `op`) are spread alongside the id.
 */
export function encodeRequest(id: number, req: EngineRequest): string {
  return JSON.stringify({ id, ...req })
}

/**
 * Decodes one line of engine output into either an `EngineEvent` or a reply
 * envelope (`{reply: id, ok: true, ...fields}` or `{reply: id, ok: false,
 * error}`). Returns `null` on invalid JSON instead of throwing.
 */
export function decodeLine(
  line: string
): EngineEvent | { reply: number; ok: boolean; [k: string]: unknown } | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
