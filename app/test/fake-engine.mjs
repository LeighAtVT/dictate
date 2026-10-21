#!/usr/bin/env node
// Fake engine for Dictate v2 Task 9 tests. A scriptable stand-in for the
// Swift engine (native/mac/DictateEngine/main.swift) that Engine
// (app/src/main/engine.ts) can spawn exactly like the real binary: it is run
// under `process.execPath` (Node), speaks the same JSON-lines protocol
// (app/src/shared/protocol.ts) over stdio, and shuts down on `quit` or
// stdin EOF.
//
// Controlled entirely by the FAKE_SCRIPT env var (inherited from the parent
// process -- Engine's spawn options carry no `env` field, so tests set
// `process.env.FAKE_SCRIPT` before calling `engine.start()`).
//
// FAKE_SCRIPT is a ';'-separated list of behaviors. ';' was chosen over ','
// because an `emit:<json>` entry's payload routinely contains commas (e.g.
// `emit:{"event":"modifiers","held":["shift","command"]}`), which a
// comma-separated list would split apart.
//
// Recognized behaviors:
//   echo           Reply `{ok:true, ...}` to every request that isn't
//                  claimed by a more specific behavior below. The payload
//                  for each op is the minimal shape its ReplyMap entry
//                  needs (see defaultReply below); e.g. stopRecording
//                  replies `{result:'text', text:'hi', seconds:0.1}`.
//   crash-on:<op>  When a request with this op arrives, exit(1) immediately
//                  without ever sending a reply -- simulates the engine
//                  process crashing mid-request.
//   hang-on:<op>   When a request with this op arrives, never reply (and
//                  never exit) -- simulates the engine wedging.
//   emit:<raw>     At startup, write <raw> verbatim as one stdout line.
//                  <raw> need not be valid JSON -- this is also how tests
//                  produce a malformed line to prove Engine ignores it
//                  instead of throwing.
//
// Every request received is also reported as a `{event:'log',
// message:'recv:<op>'}` line before any op-specific handling, so a test can
// see what the engine was asked to do -- e.g. to confirm a restarted engine
// was sent `setHotkey` again.
//
// One extra wrinkle, not part of the documented behavior list above: under
// `echo`, a `selection` request's reply is deferred one tick (setImmediate)
// while every other op replies synchronously as its request line is read.
// Requests queued back-to-back on stdin arrive as 'line' events in the same
// synchronous flush, so a `selection` sent just before a faster op (e.g.
// `context`) has its reply land *after* the faster op's -- which is what
// lets a test prove Engine matches replies to requests by id rather than by
// arrival order.

import readline from 'node:readline'

const script = (process.env.FAKE_SCRIPT ?? '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

const crashOn = new Set()
const hangOn = new Set()
const startupEmits = []
let echo = false

for (const entry of script) {
  if (entry === 'echo') {
    echo = true
  } else if (entry.startsWith('crash-on:')) {
    crashOn.add(entry.slice('crash-on:'.length))
  } else if (entry.startsWith('hang-on:')) {
    hangOn.add(entry.slice('hang-on:'.length))
  } else if (entry.startsWith('emit:')) {
    startupEmits.push(entry.slice('emit:'.length))
  }
}

function writeLine(line) {
  process.stdout.write(`${line}\n`)
}

for (const raw of startupEmits) writeLine(raw)

function defaultReply(op) {
  switch (op) {
    case 'stopRecording':
      return { result: 'text', text: 'hi', seconds: 0.1 }
    case 'context':
      return { appId: 'test.app', windowTitle: null, secureInput: false, elevated: false }
    case 'selection':
      return { text: null }
    case 'paste':
      return { result: 'pasted' }
    case 'permissions':
      return { accessibility: true, microphone: 'granted' }
    case 'secret.get':
      return { value: null }
    case 'legacyKey':
      return { key: null }
    default:
      return {}
  }
}

function respond(id, op) {
  writeLine(JSON.stringify({ reply: id, ok: true, ...defaultReply(op) }))
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  const { id, op } = req

  if (crashOn.has(op)) {
    // Flush the recv log before exiting so tests can still see it arrive.
    process.stdout.write(`${JSON.stringify({ event: 'log', message: `recv:${op}` })}\n`, () => {
      process.exit(1)
    })
    return
  }

  writeLine(JSON.stringify({ event: 'log', message: `recv:${op}` }))

  if (hangOn.has(op)) return

  if (op === 'quit') {
    process.stdout.write(`${JSON.stringify({ reply: id, ok: true })}\n`, () => {
      process.exit(0)
    })
    return
  }

  if (!echo) return

  if (op === 'selection') {
    setImmediate(() => respond(id, op))
  } else {
    respond(id, op)
  }
})

rl.on('close', () => {
  process.exit(0)
})
