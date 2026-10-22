import { describe, expect, it } from 'vitest'
import { tabIndex } from './tabs'

describe('tabIndex', () => {
  it('opens the tab named in the URL hash', () => {
    expect(tabIndex('#polish')).toBe(1)
    expect(tabIndex('#apps')).toBe(5)
  })

  it('opens the first tab (Key) with no hash or an unknown one', () => {
    expect(tabIndex('')).toBe(0)
    expect(tabIndex('#')).toBe(0)
    expect(tabIndex('#nope')).toBe(0)
  })
})
