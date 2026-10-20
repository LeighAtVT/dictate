import Foundation
import Testing
@testable import DictateCore

@Suite struct ModelChoiceTests {
    @Test func defaultsAreTheFirstPreset() {
        #expect(ModelCatalog.defaultCleanup == ModelCatalog.cleanup[0].choice)
        #expect(ModelCatalog.defaultEdit == ModelCatalog.edit[0].choice)
        #expect(ModelCatalog.defaultCleanup.id == "z-ai/glm-5.3-flash")
        #expect(ModelCatalog.defaultEdit.id == "deepseek/deepseek-v4.1-flash")
    }

    @Test func presetIDsAreUnique() {
        for list in [ModelCatalog.cleanup, ModelCatalog.edit] {
            #expect(Set(list.map(\.choice.id)).count == list.count)
        }
    }

    @Test func oldDefaultMigratesToNewDefault() {
        #expect(ModelCatalog.migrate(legacy: nil) == ModelCatalog.defaultCleanup)
        #expect(ModelCatalog.migrate(legacy: "anthropic/claude-haiku-5.5") == ModelCatalog.defaultCleanup)
        #expect(ModelCatalog.migrate(legacy: "  ") == ModelCatalog.defaultCleanup)
    }

    @Test func customLegacyModelIsKept() {
        #expect(ModelCatalog.migrate(legacy: " openai/gpt-6-sol ") == ModelChoice(id: "openai/gpt-6-sol", thinking: .modelDefault))
    }

    @Test func presetLookup() {
        #expect(ModelCatalog.preset(for: ModelCatalog.defaultCleanup, in: ModelCatalog.cleanup)?.name == "GLM 5.3 Flash")
        #expect(ModelCatalog.preset(for: ModelChoice(id: "z-ai/glm-5.3-flash", thinking: .off), in: ModelCatalog.cleanup) == nil)
        #expect(ModelCatalog.preset(for: "someone/custom", in: ModelCatalog.cleanup) == nil)
    }

    @Test func roundTripsThroughJSON() throws {
        let choice = ModelChoice(id: "z-ai/glm-5.3-flash", thinking: .minimal)
        let data = try JSONEncoder().encode(choice)
        #expect(try JSONDecoder().decode(ModelChoice.self, from: data) == choice)
    }

    @Test func reasoningParameter() {
        #expect(ModelChoice.Thinking.modelDefault.parameter == nil)
        #expect(ModelChoice.Thinking.off.parameter?["enabled"] as? Bool == false)
        #expect(ModelChoice.Thinking.minimal.parameter?["effort"] as? String == "minimal")
        #expect(ModelChoice.Thinking.low.parameter?["effort"] as? String == "low")
    }
}
