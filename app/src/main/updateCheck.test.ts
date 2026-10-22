// Task 15: the update check (Ruling R41). A fake fetch only; no real network calls.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RELEASES_URL,
  UPDATE_INTERVAL_MS,
  checkForUpdate,
  compareSemver,
  isReleaseUrl,
  scheduleUpdateChecks,
  type Update
} from './updateCheck'

const page = (tag: string): string => `https://github.com/LeighAtVT/dictate/releases/tag/${tag}`

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
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual({ version: '2.0.0-beta.2', url: page('v2.0.0-beta.2') })
  })

  it('reads the releases list (which includes prereleases), not /releases/latest', async () => {
    const f = fakeFetch([])
    await checkForUpdate(f, '2.0.0-beta.1')
    expect(f.urls).toEqual([RELEASES_URL])
    expect(RELEASES_URL).toBe('https://api.github.com/repos/LeighAtVT/dictate/releases?per_page=30')
  })

  it('the same version → null', async () => {
    expect(await checkForUpdate(fakeFetch([release('v2.0.0-beta.1')]), '2.0.0-beta.1')).toBeNull()
  })

  it('an older release only → null', async () => {
    expect(await checkForUpdate(fakeFetch([release('v2.0.0-beta.1')]), '2.0.0')).toBeNull()
  })

  it('HTTP 500 → null', async () => {
    expect(await checkForUpdate(fakeFetch({ message: 'oops' }, 500), '2.0.0-beta.1')).toBeNull()
  })

  it('a network error → null', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toBeNull()
  })

  it('bad JSON or an unexpected shape → null', async () => {
    expect(await checkForUpdate(fakeFetch('{not json'), '2.0.0-beta.1')).toBeNull()
    expect(await checkForUpdate(fakeFetch({ tag_name: 'v2.0.0' }), '2.0.0-beta.1')).toBeNull()
    expect(await checkForUpdate(fakeFetch([null, 7, { tag_name: 3 }]), '2.0.0-beta.1')).toBeNull()
  })

  it('picks the highest by semver, whatever the list order: 2.0.0 > 2.0.0-beta.9, beta.10 > beta.9', async () => {
    const f = fakeFetch([release('v2.0.0-beta.9'), release('v2.0.0'), release('v2.0.0-beta.10')])
    expect(await checkForUpdate(f, '2.0.0-beta.1')).toEqual({ version: '2.0.0', url: page('v2.0.0') })
    const g = fakeFetch([release('v2.0.0-beta.9'), release('v2.0.0-beta.10')])
    expect((await checkForUpdate(g, '2.0.0-beta.1'))?.version).toBe('2.0.0-beta.10')
  })

  it('skips drafts', async () => {
    const f = fakeFetch([release('v2.0.0', { draft: true }), release('v2.0.0-beta.2')])
    expect((await checkForUpdate(f, '2.0.0-beta.1'))?.version).toBe('2.0.0-beta.2')
  })

  it('keeps only v2.* tags', async () => {
    const f = fakeFetch([release('v1.1.0'), release('v3.0.0'), release('2.9.0'), release('v2.0.0-beta.2')])
    expect((await checkForUpdate(f, '2.0.0-beta.1'))?.version).toBe('2.0.0-beta.2')
    expect(await checkForUpdate(fakeFetch([release('v1.1.0'), release('v3.0.0')]), '2.0.0-beta.1')).toBeNull()
  })

  it('skips a tag that is not semver, and a release whose page is not on this repo', async () => {
    const f = fakeFetch([
      release('v2.1'),
      release('v2.0.0-beta.2'),
      release('v2.0.0-beta.3', { html_url: 'https://example.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.3' }),
      release('v2.0.0-beta.4', { html_url: 'http://github.com/LeighAtVT/dictate/releases/tag/v2.0.0-beta.4' })
    ])
    expect((await checkForUpdate(f, '2.0.0-beta.1'))?.version).toBe('2.0.0-beta.2')
  })

  it('a current version that is not semver → null', async () => {
    expect(await checkForUpdate(fakeFetch([release('v2.0.0')]), 'dev')).toBeNull()
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

describe('isReleaseUrl', () => {
  it("accepts only https pages on this repo's GitHub", () => {
    expect(isReleaseUrl(page('v2.0.0'))).toBe(true)
    expect(isReleaseUrl('http://github.com/LeighAtVT/dictate/releases')).toBe(false)
    expect(isReleaseUrl('https://github.com/LeighAtVT/dictate-evil/releases')).toBe(false)
    expect(isReleaseUrl('https://github.com.evil.example/LeighAtVT/dictate/')).toBe(false)
    expect(isReleaseUrl('https://github.com/LeighAtVT/dictate/../../other/repo')).toBe(false)
    expect(isReleaseUrl('file:///etc/passwd')).toBe(false)
    expect(isReleaseUrl(undefined)).toBe(false)
  })
})

describe('scheduleUpdateChecks', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks once at launch and then every 24 h, and stops when asked', async () => {
    vi.useFakeTimers()
    const found: Array<Update | null> = []
    let calls = 0
    const stop = scheduleUpdateChecks(
      async () => {
        calls++
        return calls === 2 ? { version: '2.0.0-beta.2', url: page('v2.0.0-beta.2') } : null
      },
      (u) => found.push(u)
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)
    expect(UPDATE_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(2)
    expect(found).toEqual([null, { version: '2.0.0-beta.2', url: page('v2.0.0-beta.2') }])
    stop()
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 3)
    expect(calls).toBe(2)
  })

  it('a check that throws is treated as no update', async () => {
    vi.useFakeTimers()
    const found: Array<Update | null> = []
    const stop = scheduleUpdateChecks(
      () => Promise.reject(new Error('boom')),
      (u) => found.push(u)
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(found).toEqual([null])
    stop()
  })
})
