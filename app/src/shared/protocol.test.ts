import { describe, expect, it } from 'vitest'
import { decodeLine, encodeRequest, type EngineRequest } from './protocol'
import fixturesJson from './protocol-fixtures.json'

interface Fixture {
  line: string
  kind: 'request' | 'event' | 'reply'
  op?: string
}

const fixtures = fixturesJson as Fixture[]

const REQUEST_OPS: string[] = [
  'startRecording',
  'cancelRecording',
  'stopRecording',
  'context',
  'selection',
  'paste',
  'copy',
  'setHotkey',
  'permissions',
  'requestPermission',
  'secret.get',
  'secret.set',
  'secret.delete',
  'legacyKey',
  'quit'
]

const EVENT_TYPES: string[] = ['key', 'modifiers', 'otherKey', 'escape', 'shortcut', 'model', 'log']

describe('protocol fixtures', () => {
  it('covers every request op at least once', () => {
    const requestFixtures = fixtures.filter((f) => f.kind === 'request')
    for (const op of REQUEST_OPS) {
      expect(requestFixtures.some((f) => f.op === op), `missing request fixture for op ${op}`).toBe(true)
    }
  })

  it('covers every event type at least once', () => {
    const eventFixtures = fixtures.filter((f) => f.kind === 'event')
    for (const eventType of EVENT_TYPES) {
      expect(
        eventFixtures.some((f) => JSON.parse(f.line).event === eventType),
        `missing event fixture for event ${eventType}`
      ).toBe(true)
    }
  })

  it('includes a paste request with the byte-exact special text', () => {
    const pasteFixture = fixtures.find((f) => f.kind === 'request' && f.op === 'paste')
    expect(pasteFixture).toBeDefined()
    const parsed = JSON.parse(pasteFixture!.line)
    expect(parsed.text).toBe('Line one\nLine two — “quoted” 🎙️   end')
  })

  for (const fixture of fixtures) {
    const label = `${fixture.kind}${fixture.op ? ` (${fixture.op})` : ''}: ${fixture.line}`

    it(`round-trips ${label}`, () => {
      const original = JSON.parse(fixture.line)

      if (fixture.kind === 'request') {
        const { id, ...req } = original
        const reencoded = encodeRequest(id, req as EngineRequest)
        expect(JSON.parse(reencoded)).toEqual(original)
      } else {
        const decoded = decodeLine(fixture.line)
        expect(decoded).not.toBeNull()
        expect(JSON.parse(JSON.stringify(decoded))).toEqual(original)
      }
    })
  }

  it('decodeLine returns null for invalid JSON', () => {
    expect(decodeLine('not json')).toBeNull()
  })
})
