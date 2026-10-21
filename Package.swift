// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Dictate",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Dictate", targets: ["DictateApp"]),
        .executable(name: "dictate-engine", targets: ["DictateEngine"]),
    ],
    targets: [
        .binaryTarget(
            name: "whisper",
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-b5454-xcframework.zip",
            checksum: "e57f8c48933000acabc13bb913fbe82805d483a2deff692cc6738836bd92393b"
        ),
        .target(name: "DictateCore", dependencies: ["whisper"]),
        .executableTarget(name: "DictateApp", dependencies: ["DictateCore"]),
        .target(name: "EngineKit", dependencies: ["DictateCore"], path: "native/mac/EngineKit"),
        .executableTarget(
            name: "DictateEngine",
            dependencies: ["DictateCore", "EngineKit"],
            path: "native/mac/DictateEngine"
        ),
        .testTarget(
            name: "DictateCoreTests",
            dependencies: ["DictateCore", "whisper"],
            resources: [.copy("Fixtures")]
        ),
        .testTarget(
            name: "DictateEngineTests",
            dependencies: ["EngineKit", "DictateCore"],
            path: "native/mac/Tests/DictateEngineTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
