import CryptoKit
import Foundation
import Testing
@testable import DictateCore

final class FakeDownloader: DownloadTransport, @unchecked Sendable {
    var failuresBeforeSuccess: Int
    let bytes: Data
    private(set) var calls = 0

    init(bytes: Data, failuresBeforeSuccess: Int) {
        self.bytes = bytes
        self.failuresBeforeSuccess = failuresBeforeSuccess
    }

    func download(_ url: URL, to destination: URL, progress: @Sendable (Double) -> Void) async throws {
        calls += 1
        if calls <= failuresBeforeSuccess { throw URLError(.networkConnectionLost) }
        try bytes.write(to: destination)
        progress(1)
    }
}

@Suite struct ModelStoreTests {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("models-\(UUID().uuidString)")
    let bytes = Data("pretend model weights".utf8)

    func spec(sha: String? = nil) -> ModelSpec {
        ModelSpec(url: URL(string: "https://example.com/m.bin")!, fileName: "m.bin", size: Int64(bytes.count),
                  sha256: sha ?? SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    }

    func writeModel() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try bytes.write(to: dir.appendingPathComponent("m.bin"))
    }

    @Test func readyWhenHashMatches() throws {
        try writeModel()
        #expect(ModelStore(directory: dir, spec: spec(), downloader: FakeDownloader(bytes: bytes, failuresBeforeSuccess: 0)).isReady())
    }

    @Test func notReadyWhenCorrupt() throws {
        try writeModel()
        let store = ModelStore(directory: dir, spec: spec(sha: String(repeating: "0", count: 64)), downloader: FakeDownloader(bytes: bytes, failuresBeforeSuccess: 0))
        #expect(!store.isReady())
    }

    @Test func retriesThenSucceeds() async throws {
        let d = FakeDownloader(bytes: bytes, failuresBeforeSuccess: 2)
        let store = ModelStore(directory: dir, spec: spec(), downloader: d)
        try await store.ensureModel { _ in }
        #expect(d.calls == 3)
        #expect(store.isReady())
    }

    @Test func givesUpAfterThreeFailures() async {
        let d = FakeDownloader(bytes: bytes, failuresBeforeSuccess: 5)
        let store = ModelStore(directory: dir, spec: spec(), downloader: d)
        await #expect(throws: (any Error).self) { try await store.ensureModel { _ in } }
        #expect(d.calls == 3)
    }

    @Test func corruptDownloadIsRetriedAndRejected() async {
        let d = FakeDownloader(bytes: Data("wrong".utf8), failuresBeforeSuccess: 0)
        let store = ModelStore(directory: dir, spec: spec(), downloader: d)
        await #expect(throws: (any Error).self) { try await store.ensureModel { _ in } }
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("m.bin").path))
    }

    @Test func realSpecMatchesPinnedValues() {
        #expect(ModelSpec.largeV3TurboQ5.size == 574041195)
        #expect(ModelSpec.largeV3TurboQ5.sha256 == "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2")
    }
}
