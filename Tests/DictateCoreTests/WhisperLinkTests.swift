import Testing
import whisper
@testable import DictateCore

@Test func whisperLinks() async {
    // The first whisper call sets up the Metal backend. On a CI runner's virtual GPU that took
    // 22 s, so it runs on a thread of its own rather than holding one of Swift's cooperative
    // pool threads (one per core) that every other test needs.
    let info = await onOwnThread { String(cString: whisper_print_system_info()) }
    // This build reports its Metal backend as "MTL".
    #expect(info.contains("MTL"))
}
