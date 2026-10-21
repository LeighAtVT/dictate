// Ported from Tests/DictateCoreTests/StyleRouterTests.swift. `styleFor` is the pure-function
// port of `StyleRouter.style(for:)`; `overrides` is the second argument instead of a field,
// and `bundleID` is `appId` per AppContext's TS shape.
import { describe, expect, it } from 'vitest'
import { styleFor, type AppContext } from './styleRouter'

const ctx = (appId: string, windowTitle: string | null = null, secureInput = false): AppContext => ({
  appId,
  windowTitle,
  secureInput
})

describe('styleFor', () => {
  // @Test slackDesktop
  it('routes Slack desktop to slack', () => {
    expect(styleFor(ctx('com.tinyspeck.slackmacgap'), {})).toBe('slack')
  })

  // @Test chromeGmailTab
  it('routes a Chrome Gmail tab to email', () => {
    expect(styleFor(ctx('com.google.Chrome', 'Inbox (3) - me@example.com - Gmail'), {})).toBe('email')
  })

  // @Test chromeSlackTab
  it('routes a Chrome Slack tab to slack', () => {
    expect(styleFor(ctx('com.google.Chrome', 'general (Channel) - Acme - Slack'), {})).toBe('slack')
  })

  // @Test chromeJiraTab
  it('routes a Chrome Jira tab to docs', () => {
    expect(styleFor(ctx('com.google.Chrome', '[ENG-123] Fix queue - Jira'), {})).toBe('docs')
  })

  // @Test terminalIsRaw
  it('routes Terminal to raw', () => {
    expect(styleFor(ctx('com.apple.Terminal'), {})).toBe('raw')
  })

  // @Test mailIsEmail
  it('routes Mail to email', () => {
    expect(styleFor(ctx('com.apple.mail'), {})).toBe('email')
  })

  // @Test unknownAppIsDocs
  it('routes an unknown app to docs', () => {
    expect(styleFor(ctx('com.example.Whatever'), {})).toBe('docs')
  })

  // @Test overrideWins
  it('lets an override win over the built-in app style', () => {
    expect(styleFor(ctx('com.tinyspeck.slackmacgap'), { 'com.tinyspeck.slackmacgap': 'off' })).toBe('off')
  })

  // @Test secureInputForcesOff
  it('forces off when secure input is on, even with an override', () => {
    expect(styleFor(ctx('com.apple.Terminal', null, true), { 'com.apple.Terminal': 'slack' })).toBe('off')
  })
})
