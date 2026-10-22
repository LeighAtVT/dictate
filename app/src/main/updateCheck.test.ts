// Task 15: the update check (Ruling R41). A fake fetch only; no real network calls.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RELEASES_URL,
  RETRY_AFTER_ERROR_MS,
  UPDATE_INTERVAL_MS,
  UpdateChecker,
  checkForUpdate,
  compareSemver,
  releaseUrl,
  type CheckResult,
  type Update
} from './updateCheck'

const page = (tag: string): string => `https://github.com/LeighAtVT/dictate/releases/tag/${tag}`
const update = (version: string): Update => ({ version, url: page(`v${version}`) })
const found = (version: string): CheckResult => ({ status: 'found', update: update(version) })
const NONE: CheckResult = { status: 'none' }
const ERROR: CheckResult = { status: 'error' }

interface FakeRelease {
  tag_name: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

function release(tag: string, extra: Partial<FakeRelease> = {}): FakeRelease {
  return { tag_name: tag, html_url: page(tag), draft: false, prerelease: tag.includes('-'), ...extra }
}

/** A fake fetch answering with `body` (JSON-encoded unless a string) and `status`; records each URL. */
function fakeFetch(body: unknown, status = 200): typeof fetch & { urls: string[] } {
  const urls: string[] = []
  const f = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch & { urls: string[] }
  f.urls = urls
  return f
}

describe('checkForUpdate', () => {
  it('2.0.0-beta.2 beats 2.0.0-beta.1', async () => {
    const f = fakeFetch([release('v2.0.0-beta.1'), release('v2.0.0-beta.2')])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0-beta.2'))
  })

  it('reads the releases list (which includes prereleases), not /releases/latest', async () => {
    const f = fakeFetch([])
    await checkForUpdate(f, '2.0.0-beta.1')
    expect(f.urls).toEqual([RELEASES_URL])
    expect(RELEASES_URL).toBe('https://api.github.com/repos/LeighAtVT/dictate/releases?per_page=30')
  })

  it('the same version → none', async () => {
    expect(await checkForUpdate(fakeFetch([release('v2.0.0-beta.1')]), '2.0.0-beta.1')).toEqual(NONE)
  })

  it('an older release only → none', async () => {
    expect(await checkForUpdate(fakeFetch([release('v2.0.0-beta.1')]), '2.0.0')).toEqual(NONE)
  })

  it('HTTP 500 → error (not none)', async () => {
    expect(await checkForUpdate(fakeFetch({ message: 'oops' }, 500), '2.0.0-beta.1')).toEqual(ERROR)
  })

  it('a network error → error', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(ERROR)
  })

  it('bad JSON or a reply that is not a list → error; a list with nothing usable → none', async () => {
    expect(await checkForUpdate(fakeFetch('{not json'), '2.0.0-beta.1')).toEqual(ERROR)
    expect(await checkForUpdate(fakeFetch({ tag_name: 'v2.0.0' }), '2.0.0-beta.1')).toEqual(ERROR)
    expect(await checkForUpdate(fakeFetch([null, 7, { tag_name: 3 }]), '2.0.0-beta.1')).toEqual(NONE)
  })

  it('picks the highest by semver, whatever the list order: 2.0.0 > 2.0.0-beta.9, beta.10 > beta.9', async () => {
    const f = fakeFetch([release('v2.0.0-beta.9'), release('v2.0.0'), release('v2.0.0-beta.10')])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0'))
    const g = fakeFetch([release('v2.0.0-beta.9'), release('v2.0.0-beta.10')])
    expect(await checkForUpdate(g, '2.0.0-beta.1')).toEqual(found('2.0.0-beta.10'))
  })

  it('skips drafts', async () => {
    const f = fakeFetch([release('v2.0.0', { draft: true }), release('v2.0.0-beta.2')])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0-beta.2'))
  })

  it('keeps only v2.* tags', async () => {
    const f = fakeFetch([release('v1.1.0'), release('v3.0.0'), release('2.9.0'), release('v2.0.0-beta.2')])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0-beta.2'))
    expect(await checkForUpdate(fakeFetch([release('v1.1.0'), release('v3.0.0')]), '2.0.0-beta.1')).toEqual(NONE)
  })

  it('normalizes the release page URL', async () => {
    const f = fakeFetch([release('v2.0.0', { html_url: 'https://GitHub.com/LeighAtVT/dictate/releases/tag/v2.0.0' })])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0'))
  })

  it('skips a tag that is not semver, and a release whose page is not on this repo', async () => {
    const f = fakeFetch([
      release('v2.1'),
      release('v2.0.0-beta.2'),
      release('v2.0.0-beta.3', { html_url: 'https://example.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.3' }),
      release('v2.0.0-beta.4', { html_url: 'http://github.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.4' })
    ])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual(found('2.0.0-beta.2'))
  })

  it('a current version that is not semver → none, without a request', async () => {
    const f = fakeFetch([release('v2.0.0')])
    expect(await checkForUpdate(f, 'dev')).toEqual(NONE)
    expect(f.urls).toEqual([])
  })
})

describe('compareSemver', () => {
  // The precedence example from semver.org, section 11.
  it('orders prereleases by semver precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0-beta.1',
      '2.0.0'
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i], ordered[i + 1])).toBeLessThan(0)
      expect(compareSemver(ordered[i + 1], ordered[i])).toBeGreaterThan(0)
    }
    expect(compareSemver('2.0.0-beta.1', '2.0.0-beta.1')).toBe(0)
    expect(compareSemver('2.0.0+build.5', '2.0.0')).toBe(0)
  })

  it('returns null when either side is not semver', () => {
    expect(compareSemver('2.0', '2.0.0')).toBeNull()
    expect(compareSemver('2.0.0', 'v2.0.0')).toBeNull()
    expect(compareSemver('02.0.0', '2.0.0')).toBeNull()
  })
})

describe('releaseUrl', () => {
  it("returns the normalized URL of an https page on this repo's GitHub, and null for anything else", () => {
    expect(releaseUrl(page('v2.0.0'))).toBe(page('v2.0.0'))
    expect(releaseUrl('https://GITHUB.com/LeighAtVT/dictate/releases/tag/v2.0.0')).toBe(page('v2.0.0'))
    expect(releaseUrl('https://github.com/LeighAtVT/dictate/releases/tag/v2 0')).toBe(
      'https://github.com/LeighAtVT/dictate/releases/tag/v2%200'
    )
    expect(releaseUrl('http://github.com/LeighAtVT/dictate/releases')).toBeNull()
    expect(releaseUrl('https://github.com/LeighAtVT/dictate-evil/releases')).toBeNull()
    expect(releaseUrl('https://github.com.evil.example/LeighAtVT/dictate/')).toBeNull()
    expect(releaseUrl('https://github.com/LeighAtVT/dictate/../../other/repo')).toBeNull()
    expect(releaseUrl('https://user@github.com/LeighAtVT/dictate/')).toBeNull()
    expect(releaseUrl('file:///etc/passwd')).toBeNull()
    expect(releaseUrl(undefined)).toBeNull()
  })
})

describe('UpdateChecker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A checker whose check answers from `results` in turn (the last repeats); records what it logs. */
  function harness(results: Array<CheckResult | Error>, onFound?: (u: Update) => void) {
    const logs: string[] = []
    let calls = 0
    const checker = new UpdateChecker({
      check: async () => {
        const r = results[Math.min(calls, results.length - 1)]
        calls++
        if (r instanceof Error) throw r
        return r
      },
      log: (m) => logs.push(m),
      onFound
    })
    return { checker, logs, calls: () => calls }
  }

  it('checks once at launch and then every 24 h, with one timer at a time, and stops when asked', async () => {
    vi.useFakeTimers()
    const h = harness([NONE, found('2.0.0-beta.2')])
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls()).toBe(1)
    expect(h.checker.status).toBe('none')
    expect(vi.getTimerCount()).toBe(1)
    expect(UPDATE_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1)
    expect(h.calls()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls()).toBe(2)
    expect(h.checker.update).toEqual(update('2.0.0-beta.2'))
    expect(h.checker.status).toBe('found')
    expect(vi.getTimerCount()).toBe(1)
    h.checker.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 3)
    expect(h.calls()).toBe(2)
  })

  it('keeps the last known update when a check fails, and retries after 1 h', async () => {
    vi.useFakeTimers()
    const h = harness([found('2.0.0-beta.2'), ERROR, found('2.0.0-beta.3')])
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(h.calls()).toBe(2)
    expect(h.checker.status).toBe('error')
    expect(h.checker.update).toEqual(update('2.0.0-beta.2'))
    expect(RETRY_AFTER_ERROR_MS).toBe(60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_ERROR_MS - 1)
    expect(h.calls()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls()).toBe(3)
    expect(h.checker.update).toEqual(update('2.0.0-beta.3'))
    // Back to the daily check after a success.
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_ERROR_MS)
    expect(h.calls()).toBe(3)
    expect(vi.getTimerCount()).toBe(1)
    h.checker.stop()
  })

  it('a check that finds nothing clears a known update', async () => {
    vi.useFakeTimers()
    const h = harness([found('2.0.0-beta.2'), NONE])
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.checker.update).not.toBeNull()
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(h.checker.update).toBeNull()
    expect(h.checker.status).toBe('none')
    h.checker.stop()
  })

  it('checkNow (wake from sleep) checks at once and replaces the pending timer', async () => {
    vi.useFakeTimers()
    const h = harness([NONE])
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS / 2)
    h.checker.checkNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls()).toBe(2)
    expect(vi.getTimerCount()).toBe(1)
    // The next one is a full day after the wake-up check, not the original schedule.
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS / 2)
    expect(h.calls()).toBe(2)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS / 2)
    expect(h.calls()).toBe(3)
    h.checker.stop()
  })

  it('never runs two checks at once', async () => {
    vi.useFakeTimers()
    let release!: (r: CheckResult) => void
    let calls = 0
    const checker = new UpdateChecker({
      check: () => {
        calls++
        return new Promise<CheckResult>((resolve) => {
          release = resolve
        })
      },
      log: () => {}
    })
    checker.start()
    checker.checkNow()
    checker.checkNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    release(NONE)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    checker.stop()
  })

  it('a check still running at stop() schedules nothing afterwards', async () => {
    vi.useFakeTimers()
    let release!: (r: CheckResult) => void
    const checker = new UpdateChecker({
      check: () => new Promise<CheckResult>((resolve) => (release = resolve)),
      log: () => {}
    })
    checker.start()
    checker.stop()
    release(NONE)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('calls onFound once per new version, and logs (not swallows) its errors', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const h = harness([found('2.0.0-beta.2'), found('2.0.0-beta.2'), found('2.0.0-beta.3')], (u) => {
      seen.push(u.version)
      if (u.version === '2.0.0-beta.3') throw new Error('tray gone')
    })
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(seen).toEqual(['2.0.0-beta.2', '2.0.0-beta.3'])
    expect(h.logs).toEqual(['update check: handling 2.0.0-beta.3 failed: tray gone'])
    expect(h.checker.update).toEqual(update('2.0.0-beta.3'))
    expect(vi.getTimerCount()).toBe(1)
    h.checker.stop()
  })

  it('logs a check that throws, treats it as a failed check, and retries after 1 h', async () => {
    vi.useFakeTimers()
    const h = harness([new Error('boom'), NONE])
    h.checker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.checker.status).toBe('error')
    expect(h.logs).toEqual(['update check failed: boom'])
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_ERROR_MS)
    expect(h.checker.status).toBe('none')
    h.checker.stop()
  })
})
