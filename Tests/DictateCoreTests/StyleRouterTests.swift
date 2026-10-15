import Testing
@testable import DictateCore

@Suite struct StyleRouterTests {
    let router = StyleRouter()

    @Test func slackDesktop() { #expect(router.style(for: AppContext(bundleID: "com.tinyspeck.slackmacgap")) == .slack) }
    @Test func chromeGmailTab() {
        #expect(router.style(for: AppContext(bundleID: "com.google.Chrome", windowTitle: "Inbox (3) - me@example.com - Gmail")) == .email)
    }
    @Test func chromeSlackTab() { #expect(router.style(for: AppContext(bundleID: "com.google.Chrome", windowTitle: "general (Channel) - Acme - Slack")) == .slack) }
    @Test func chromeJiraTab() { #expect(router.style(for: AppContext(bundleID: "com.google.Chrome", windowTitle: "[ENG-123] Fix queue - Jira")) == .docs) }
    @Test func terminalIsRaw() { #expect(router.style(for: AppContext(bundleID: "com.apple.Terminal")) == .raw) }
    @Test func mailIsEmail() { #expect(router.style(for: AppContext(bundleID: "com.apple.mail")) == .email) }
    @Test func unknownAppIsDocs() { #expect(router.style(for: AppContext(bundleID: "com.example.Whatever")) == .docs) }
    @Test func overrideWins() {
        let r = StyleRouter(overrides: ["com.tinyspeck.slackmacgap": .off])
        #expect(r.style(for: AppContext(bundleID: "com.tinyspeck.slackmacgap")) == .off)
    }
    @Test func secureInputForcesOff() {
        let r = StyleRouter(overrides: ["com.apple.Terminal": .slack])
        #expect(r.style(for: AppContext(bundleID: "com.apple.Terminal", secureInput: true)) == .off)
    }
}
