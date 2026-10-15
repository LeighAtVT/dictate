import Testing
import whisper
@testable import DictateCore

@Test func whisperLinks() {
    let info = String(cString: whisper_print_system_info())
    // This build reports its Metal backend as "MTL".
    #expect(info.contains("MTL"))
}
