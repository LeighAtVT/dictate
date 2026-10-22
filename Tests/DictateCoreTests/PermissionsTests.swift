import AVFoundation
import Testing
@testable import DictateCore

// Dictate v2 Mac Preview, Task 5, fix round 1: ruling R1's
// AVAuthorizationStatus -> wire-protocol-string mapping, as a pure function,
// so all four branches are provable without depending on this machine's
// actual microphone permission state.
@Suite struct PermissionsTests {
    @Test func authorizedMapsToGranted() {
        #expect(Permissions.microphoneStatusName(for: .authorized) == "granted")
    }

    @Test func deniedMapsToDenied() {
        #expect(Permissions.microphoneStatusName(for: .denied) == "denied")
    }

    @Test func restrictedMapsToDenied() {
        #expect(Permissions.microphoneStatusName(for: .restricted) == "denied")
    }

    @Test func notDeterminedMapsToUndetermined() {
        #expect(Permissions.microphoneStatusName(for: .notDetermined) == "undetermined")
    }
}
