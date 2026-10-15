import CryptoKit
import Foundation

public struct ModelSpec: Sendable {
    public let url: URL
    public let fileName: String
    public let size: Int64
    public let sha256: String

    public init(url: URL, fileName: String, size: Int64, sha256: String) {
        self.url = url
        self.fileName = fileName
        self.size = size
        self.sha256 = sha256
    }

    public static let largeV3TurboQ5 = ModelSpec(
        url: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin")!,
        fileName: "ggml-large-v3-turbo-q5_0.bin",
        size: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"
    )
}

public protocol DownloadTransport: Sendable {
    func download(_ url: URL, to destination: URL, progress: @Sendable (Double) -> Void) async throws
}

public struct ModelStoreError: Error, CustomStringConvertible {
    public let description: String
}

/// Downloads the Whisper model once and verifies it by size and SHA-256 before use.
public final class ModelStore: @unchecked Sendable {
    static let maxAttempts = 3

    let directory: URL
    let spec: ModelSpec
    let downloader: DownloadTransport

    public init(directory: URL, spec: ModelSpec, downloader: DownloadTransport) {
        self.directory = directory
        self.spec = spec
        self.downloader = downloader
    }

    public var modelURL: URL { directory.appendingPathComponent(spec.fileName) }

    public func isReady() -> Bool { Self.verify(modelURL, spec: spec) }

    public func ensureModel(progress: @escaping @Sendable (Double) -> Void) async throws {
        if isReady() { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: modelURL)
        let partial = directory.appendingPathComponent(spec.fileName + ".partial")
        var lastError: Error = ModelStoreError(description: "Model download failed")
        for _ in 0..<Self.maxAttempts {
            try? FileManager.default.removeItem(at: partial)
            do {
                try await downloader.download(spec.url, to: partial, progress: progress)
                guard Self.verify(partial, spec: spec) else {
                    lastError = ModelStoreError(description: "Downloaded model failed verification")
                    continue
                }
                try FileManager.default.moveItem(at: partial, to: modelURL)
                return
            } catch {
                lastError = error
            }
        }
        try? FileManager.default.removeItem(at: partial)
        throw lastError
    }

    static func verify(_ url: URL, spec: ModelSpec) -> Bool {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              (attrs[.size] as? NSNumber)?.int64Value == spec.size,
              let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try? handle.read(upToCount: 4 * 1024 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined() == spec.sha256
    }
}

/// URLSession download with progress reporting.
public struct URLSessionDownloader: DownloadTransport {
    public init() {}

    public func download(_ url: URL, to destination: URL, progress: @Sendable (Double) -> Void) async throws {
        let (bytes, response) = try await URLSession.shared.bytes(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ModelStoreError(description: "Model download returned an error")
        }
        let total = Double(max(response.expectedContentLength, 1))
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        var buffer = Data()
        buffer.reserveCapacity(1 << 20)
        var written = 0.0
        for try await byte in bytes {
            buffer.append(byte)
            if buffer.count >= 1 << 20 {
                try handle.write(contentsOf: buffer)
                written += Double(buffer.count)
                buffer.removeAll(keepingCapacity: true)
                progress(written / total)
            }
        }
        try handle.write(contentsOf: buffer)
        progress(1)
    }
}
