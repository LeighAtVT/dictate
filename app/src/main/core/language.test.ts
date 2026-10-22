// Ported from Sources/DictateCore/Language.swift. There is no LanguageTests.swift in
// Tests/DictateCoreTests (grep confirms none exists; Language's only exercise in the
// Swift suite is indirectly through PipelineModesTests/PipelineTests, which are out of
// scope for Task 6), so these are authored directly against `LanguageSettings.output`'s
// documented behavior rather than a 1:1 @Test port: same when paste is "same", same
// when paste equals spoken, same when paste is an unknown code, and the English name
// otherwise.
import { describe, expect, it } from 'vitest'
import { LANGUAGES, outputLanguage } from './language'

describe('LANGUAGES', () => {
  it('has the 18 seeded languages, including Japanese', () => {
    expect(LANGUAGES).toHaveLength(18)
    expect(LANGUAGES).toContainEqual({ code: 'ja', name: 'Japanese' })
  })
})

describe('outputLanguage', () => {
  it('is same when paste is "same"', () => {
    expect(outputLanguage('en', 'same')).toEqual({ kind: 'same' })
  })

  it('is same when paste equals spoken', () => {
    expect(outputLanguage('en', 'en')).toEqual({ kind: 'same' })
  })

  it('is same when paste is an unrecognized code', () => {
    expect(outputLanguage('en', 'xx')).toEqual({ kind: 'same' })
  })

  it('is the English name of the paste language otherwise', () => {
    expect(outputLanguage('es', 'en')).toEqual({ kind: 'language', name: 'English' })
  })
})
