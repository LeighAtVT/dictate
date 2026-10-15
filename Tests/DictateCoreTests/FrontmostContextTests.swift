import ApplicationServices
import Testing
@testable import DictateCore

@Suite struct FocusDecisionTests {
    @Test func electronWithNoReportedFocusStillPastes() {
        #expect(FrontmostContext.looksLikeTextTarget(error: .noValue, role: nil, editable: nil, valueSettable: false, bundleID: "com.tinyspeck.slackmacgap"))
    }
    @Test func finderWithNothingFocusedCopiesOnly() {
        #expect(!FrontmostContext.looksLikeTextTarget(error: .noValue, role: nil, editable: nil, valueSettable: false, bundleID: "com.apple.finder"))
    }
    @Test func textAreaPastes() {
        #expect(FrontmostContext.looksLikeTextTarget(error: .success, role: "AXTextArea", editable: nil, valueSettable: false, bundleID: "com.apple.Notes"))
    }
    @Test func axErrorPastes() {
        #expect(FrontmostContext.looksLikeTextTarget(error: .cannotComplete, role: nil, editable: nil, valueSettable: false, bundleID: "com.google.Chrome"))
    }
    @Test func finderListCopiesOnly() {
        #expect(!FrontmostContext.looksLikeTextTarget(error: .success, role: "AXOutline", editable: nil, valueSettable: false, bundleID: "com.apple.finder"))
    }
}
