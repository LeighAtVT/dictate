// Dictate v2, Task 15: the update check (spec 2.2 `UpdateCheck`, 6.3). Once at launch and then
// every 24 h it reads this repo's GitHub releases and reports the newest v2 release that's newer
// than this build; the tray then shows "Update available (v…)" (trayModel.ts). No automatic
// updates. GitHub's /releases/latest skips prereleases, so this reads the releases list instead
// (Ruling R41). A network or HTTP error, or an unexpected reply, is a failed check: the last known
// update is kept and the check is retried after an hour (Ruling R46).

export const RELEASES_URL = 'https://api.github.com/repos/LeighAtVT/dictate/releases?per_page=30'
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
export const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000
const TIMEOUT_MS = 15_000

export interface Update {
  /** Semver without the tag's "v", e.g. "2.0.0-beta.2". */
  version: string
  /** The release's GitHub page, normalized by `releaseUrl`. */
  url: string
}

/** One check's answer: a newer release, nothing newer, or the check failed. */
export type CheckResult = { status: 'found'; update: Update } | { status: 'none' } | { status: 'error' }

/**
 * The normalized URL (`new URL(url).href`) when `url` is a page of this repo on github.com over
 * https, else null. The tray opens nothing else.
 */
export function releaseUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const ok =
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname.startsWith('/LeighAtVT/dictate/')
  return ok ? parsed.href : null
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
  const page = releaseUrl(url)
  if (parse(version) === null || page === null) return null
  return { version, url: page }
}

/**
 * The newest v2 release newer than `current` ('found'), nothing newer ('none'), or 'error' when
 * GitHub couldn't be reached or answered with something other than a list of releases. A
 * `current` that isn't semver can't be compared, so it's 'none' without a request.
 */
export async function checkForUpdate(fetchFn: typeof fetch, current: string): Promise<CheckResult> {
  if (parse(current) === null) return { status: 'none' }
  let releases: unknown
  try {
    const response = await fetchFn(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Dictate' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return { status: 'error' }
    releases = await response.json()
  } catch {
    return { status: 'error' }
  }
  if (!Array.isArray(releases)) return { status: 'error' }

  let best: Update | null = null
  for (const release of releases) {
    const c = candidate(release)
    if (c && (best === null || (compareSemver(c.version, best.version) ?? 0) > 0)) best = c
  }
  if (best === null || (compareSemver(best.version, current) ?? 0) <= 0) return { status: 'none' }
  return { status: 'found', update: best }
}

/** Where the update check stands, for the tray and Copy diagnostics. */
export type UpdateStatus = 'pending' | 'found' | 'none' | 'error'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Runs the check at `start()` and then every 24 h, or 1 h after a failed check, which keeps the
 * last known update. `checkNow()` (on wake from sleep) checks at once unless a check is already
 * running. There is never more than one check in flight or one timer pending, and none after
 * `stop()`. `onFound` runs once per newly found version; its errors, and a check that throws,
 * are logged rather than swallowed.
 */
export class UpdateChecker {
  /** The newest known release newer than this build; kept through failed checks. */
  update: Update | null = null
  status: UpdateStatus = 'pending'
  private readonly check: () => Promise<CheckResult>
  private readonly log: (message: string) => void
  private readonly onFound?: (update: Update) => void
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private stopped = false

  constructor(deps: { check: () => Promise<CheckResult>; log: (message: string) => void; onFound?: (update: Update) => void }) {
    this.check = deps.check
    this.log = deps.log
    this.onFound = deps.onFound
  }

  start(): void {
    this.checkNow()
  }

  checkNow(): void {
    if (this.running || this.stopped) return
    this.clearTimer()
    this.running = true
    this.check()
      .catch((error: unknown): CheckResult => {
        this.log(`update check failed: ${message(error)}`)
        return { status: 'error' }
      })
      .then((result) => this.apply(result))
      .finally(() => {
        this.running = false
        if (!this.stopped) {
          this.timer = setTimeout(() => this.checkNow(), this.status === 'error' ? RETRY_AFTER_ERROR_MS : UPDATE_INTERVAL_MS)
        }
      })
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
  }

  private apply(result: CheckResult): void {
    if (result.status === 'error') {
      this.status = 'error'
      return
    }
    if (result.status === 'none') {
      this.status = 'none'
      this.update = null
      return
    }
    const isNew = result.update.version !== this.update?.version
    this.status = 'found'
    this.update = result.update
    if (!isNew || !this.onFound) return
    try {
      this.onFound(result.update)
    } catch (error) {
      this.log(`update check: handling ${result.update.version} failed: ${message(error)}`)
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
