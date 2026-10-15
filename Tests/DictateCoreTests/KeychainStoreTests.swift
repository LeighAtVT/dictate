import Testing
@testable import DictateCore

@Suite(.serialized) struct KeychainStoreTests {
    let store = KeychainStore(service: "com.leigh.dictate.tests", account: "openrouter")

    @Test func keychainRoundTrip() throws {
        try store.write("sk-or-test-1")
        #expect(store.read() == "sk-or-test-1")
        try store.delete()
        #expect(store.read() == nil)
    }

    @Test func keychainOverwrite() throws {
        try store.write("first")
        try store.write("second")
        #expect(store.read() == "second")
        try store.delete()
    }
}
