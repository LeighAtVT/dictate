import { describe, expect, it } from 'vitest'
import { appRows, withOverride } from './appRows'

describe('appRows', () => {
  it('joins history apps and overridden apps, once each, sorted, without blanks or "note"', () => {
    expect(
      appRows(['com.tinyspeck.slackmacgap', 'note', '', 'com.apple.TextEdit'], {
        'com.apple.mail': 'off',
        'com.apple.TextEdit': 'raw'
      })
    ).toEqual(['com.apple.TextEdit', 'com.apple.mail', 'com.tinyspeck.slackmacgap'])
  })

  it('is empty with no history and no overrides', () => {
    expect(appRows([], {})).toEqual([])
  })
})

describe('withOverride', () => {
  it('sets a style, and "Automatic" (null) removes the override', () => {
    const set = withOverride({}, 'com.apple.mail', 'email')
    expect(set).toEqual({ 'com.apple.mail': 'email' })
    expect(withOverride(set, 'com.apple.mail', null)).toEqual({})
    expect(set).toEqual({ 'com.apple.mail': 'email' })
  })
})
