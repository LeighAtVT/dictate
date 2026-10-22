// Dictate v2, Task 15: the update check (spec 2.2 `UpdateCheck`, 6.3). Once at launch and then
// every 24 h it reads this repo's GitHub releases and reports the newest v2 release that's newer
// than this build; the tray then shows "Update available (v…)" (trayModel.ts). No automatic
// updates. GitHub's /releases/latest skips prereleases, so this reads the releases list instead
// (Ruling R41). Any network or HTTP error, or an unexpected reply, counts as no update.

export const RELEASES_URL = 'https://api.github.com/repos/LeighAtVT/dictate/releases?per_page=30'
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000

export interface Update {
  /** Semver without the tag's "v", e.g. "2.0.0-beta.2". */
  version: string
  /** The release's GitHub page; always passes `isReleaseUrl`. */
  url: string
}

/** Only pages of this repo on github.com, over https: the tray opens nothing else. */
export function isReleaseUrl(url: string | undefined): url is string {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname.startsWith('/LeighAtVT/dictate/')
  )
}

// semver.org 2.0.0, section 9-10: no leading zeros; build metadata is ignored for precedence.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

interface Semver {
  core: [number, number, number]
  pre: string[]
}

function parse(version: string): Semver | null {
  const m = SEMVER.exec(version)
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) return Math.sign(Number(a) - Number(b))
  // A numeric identifier sorts below an alphanumeric one.
  if (an !== bn) return an ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver precedence (semver.org section 11): negative when `a` is older, 0 when equal, positive
 * when newer; null when either isn't semver. A release outranks its prereleases
 * (2.0.0 > 2.0.0-beta.9), and prerelease parts compare numerically (beta.10 > beta.9).
 */
export function compareSemver(a: string, b: string): number | null {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return Math.sign(x.core[i] - y.core[i])
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length)
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const c = compareIdentifiers(x.pre[i], y.pre[i])
    if (c !== 0) return c
  }
  return Math.sign(x.pre.length - y.pre.length)
}

/** A release from the list that could be offered: published, tagged v2.*, semver, a page on this repo. */
function candidate(release: unknown): Update | null {
  if (typeof release !== 'object' || release === null) return null
  const r = release as Record<string, unknown>
  if (r['draft'] === true) return null
  const tag = r['tag_name']
  const url = r['html_url']
  if (typeof tag !== 'string' || !tag.startsWith('v2.')) return null
  const version = tag.slice(1)
  if (parse(version) === null || typeof url !== 'string' || !isReleaseUrl(url)) return null
  return { version, url }
}

/** The newest v2 release newer than `current`, or null (also on any error). */
export async function checkForUpdate(fetchFn: typeof fetch, current: string): Promise<Update | null> {
  if (parse(current) === null) return null
  let releases: unknown
  try {
    const response = await fetchFn(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dictate' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return null
    releases = await response.json()
  } catch {
    return null
  }
  if (!Array.isArray(releases)) return null

  let best: Update | null = null
  for (const release of releases) {
    const c = candidate(release)
    if (c && (best === null || (compareSemver(c.version, best.version) ?? 0) > 0)) best = c
  }
  if (best === null || (compareSemver(best.version, current) ?? 0) <= 0) return null
  return best
}

/**
 * Runs `check` now and then every 24 h, handing each result to `onResult` (null when the check
 * threw). A check still running when the next is due is not doubled up. Returns a stop function.
 */
export function scheduleUpdateChecks(check: () => Promise<Update | null>, onResult: (update: Update | null) => void): () => void {
  let running = false
  const run = (): void => {
    if (running) return
    running = true
    check()
      .catch(() => null)
      .then(onResult)
      .catch(() => {})
      .finally(() => {
        running = false
      })
  }
  const first = setTimeout(run, 0)
  const timer = setInterval(run, UPDATE_INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
