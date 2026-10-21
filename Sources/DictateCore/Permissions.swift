import AVFoundation
import AppKit
import ApplicationServices

// Dictate v2 Mac Preview, Task 5 (controller ruling R7): moved out of v1's
// `Sources/DictateApp/OnboardingView.swift` so the v2 engine's
// `permissions`/`requestPermission` ops (`native/mac/EngineKit/Desktop.swift`)
// can use the same checks without the engine depending on `DictateApp`'s
// SwiftUI target, and without `DictateApp` taking on a dependency on
// `EngineKit`. Behavior is unchanged from v1 except `microphoneStatusName`,
// which is new (needed for the wire protocol's `permissions` reply shape).

/// Microphone and Accessibility permission checks and requests.
public enum Permissions {
    public static var microphoneStatus: AVAuthorizationStatus { AVCaptureDevice.authorizationStatus(for: .audio) }
    public static var microphone: Bool { microphoneStatus == .authorized }
    public static var accessibility: Bool { AXIsProcessTrusted() }
    public static var allGranted: Bool { microphone && accessibility }

    /// The wire protocol's `permissions` reply reports microphone as
    /// `"granted"|"denied"|"undetermined"` (controller ruling R1): `.authorized` →
    /// `"granted"`, `.notDetermined` → `"undetermined"`, and `.denied` as well as
    /// `.restricted` both → `"denied"` (restricted has no retry path, so it's
    /// treated the same as an outright denial).
    public static var microphoneStatusName: String { microphoneStatusName(for: microphoneStatus) }

    /// Pure version of `microphoneStatusName`, so ruling R1's mapping can be tested directly
    /// against all four `AVAuthorizationStatus` cases without depending on this machine's actual
    /// microphone permission state.
    public static func microphoneStatusName(for status: AVAuthorizationStatus) -> String {
        switch status {
        case .authorized: "granted"
        case .notDetermined: "undetermined"
        case .denied, .restricted: "denied"
        @unknown default: "denied"
        }
    }

    public static func requestMicrophone() {
        if microphoneStatus == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { _ in }
        } else {
            open("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
    }

    public static func requestAccessibility() {
        // Adds Dictate to the Accessibility list so it only needs switching on.
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    private static func open(_ url: String) {
        if let url = URL(string: url) { NSWorkspace.shared.open(url) }
    }
}
