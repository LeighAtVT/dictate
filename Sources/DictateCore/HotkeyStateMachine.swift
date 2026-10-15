import Foundation

public enum HotkeyEvent: Sendable {
    case keyDown(TimeInterval)
    case keyUp(TimeInterval)
    case otherKeyDown
    case escapeDown
    /// Delivered `doubleTapWindow` after a short tap's release.
    case timeout(TimeInterval)
}

public enum HotkeyAction: Equatable, Sendable {
    case none, beginRecording, lockRecording, finishRecording, cancelRecording
}

/// Hold-to-talk plus hands-free, kept free of event-tap plumbing so it can be tested.
/// - Hold the key: record while held, finish on release.
/// - Double-tap: keep recording hands-free; tap once more to finish, Esc to cancel.
/// Recording starts on the first key-down so no word is clipped. Using the key as a modifier
/// (another key pressed while held) cancels.
public struct HotkeyStateMachine: Sendable {
    enum State: Equatable {
        case idle
        case holding(since: TimeInterval)
        case tapped(at: TimeInterval)
        case lockedDown, locked, finishingDown, cancelled
    }

    public static let doubleTapWindow: TimeInterval = 0.35

    let minHold: TimeInterval
    var state: State = .idle

    public init(minHold: TimeInterval = 0.3) {
        self.minHold = minHold
    }

    /// True right after a short tap: the monitor should deliver `.timeout` after `doubleTapWindow`.
    public var awaitingSecondTap: Bool {
        if case .tapped = state { return true }
        return false
    }

    public mutating func handle(_ event: HotkeyEvent) -> HotkeyAction {
        switch (state, event) {
        case (.idle, .keyDown(let t)):
            state = .holding(since: t)
            return .beginRecording
        case (.holding(let since), .keyUp(let t)):
            if t - since >= minHold {
                state = .idle
                return .finishRecording
            }
            state = .tapped(at: t)
            return .none
        case (.holding, .otherKeyDown), (.holding, .escapeDown):
            state = .cancelled
            return .cancelRecording
        case (.tapped(let at), .keyDown(let t)):
            if t - at <= Self.doubleTapWindow {
                state = .lockedDown
                return .lockRecording
            }
            state = .idle
            return .cancelRecording
        case (.tapped(let at), .timeout(let t)) where t - at >= Self.doubleTapWindow - 0.01:
            state = .idle
            return .cancelRecording
        case (.tapped, .otherKeyDown), (.tapped, .escapeDown):
            state = .idle
            return .cancelRecording
        case (.lockedDown, .keyUp):
            state = .locked
            return .none
        case (.locked, .keyDown), (.lockedDown, .keyDown):
            state = .finishingDown
            return .finishRecording
        case (.locked, .escapeDown), (.lockedDown, .escapeDown):
            state = .idle
            return .cancelRecording
        case (.finishingDown, .keyUp), (.cancelled, .keyUp):
            state = .idle
            return .none
        default:
            return .none
        }
    }
}
