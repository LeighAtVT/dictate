// Dictate v2, Task 14: what goes into dictate.log, kept out of index.ts so it can be tested. The
// lines are v1's (Sources/DictateApp/AppDelegate.swift `startJournal`, `record`, `report`): the
// launch line, an unexpected previous stop and its crash reports, and one line per finished
// dictation. Never given dictated text, the key, or request bodies (global-constraints.md).
import type { EventLog } from './core/eventLog'
import type { PipelineOutcome, StageTimings } from './core/pipeline'
import { RunJournal, type RunRecord } from './core/runJournal'
import { outcomeLogLine } from './appStatus'

/** v1's `record`: writes one line, and never lets a failed write break dictation. */
export function logRecorder(events: EventLog): (message: string) => void {
  return (message) => {
    try {
      events.write(message)
    } catch {
      // Logging must never break dictation.
    }
  }
}

/** v1's launch line, plus the version. `agent`: started by the login agent (`isAgentLaunch`). */
export function launchLine(o: { pid: number; version: string; agent: boolean; accessibility: boolean }): string {
  return `launch pid=${o.pid} version=${o.version} agent=${o.agent} accessibility=${o.accessibility}`
}

/**
 * v1's report of a run that didn't end cleanly, then the crash reports written since it launched,
 * newest first: `.ips` files in `reportsDir` whose names start with "Dictate", which matches both
 * v1 ("Dictate-…") and the preview ("Dictate Preview-…").
 */
export function previousRunLines(previous: RunRecord, reportsDir: string): string[] {
  const lines = [`previous run ended unexpectedly (pid=${previous.pid} launched ${previous.launchedAt})`]
  for (const file of RunJournal.crashReports(reportsDir, new Date(previous.launchedAt))) lines.push(`crash report: ${file}`)
  return lines
}

/** v1's `report`: one line per finished dictation (timings when pasted, the reason when failed). */
export function dictationReporter(
  record: (message: string) => void,
  timings: () => StageTimings | null
): (outcome: PipelineOutcome | null) => void {
  return (outcome) => {
    const line = outcomeLogLine(outcome, timings())
    if (line) record(line)
  }
}
