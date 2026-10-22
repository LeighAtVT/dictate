// Dictate v2, Task 11: end-to-end test helper (scripts/e2e-mac.sh). Saves every item and type on
// the general pasteboard to a file and puts it back later, so a test run leaves the user's
// clipboard (text, images, files, rich text) exactly as it found it.
//
//   clipboard-snapshot save <file>
//   clipboard-snapshot restore <file>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, ["save", "restore"].contains(args[1]) else {
    FileHandle.standardError.write(Data("usage: clipboard-snapshot save|restore <file>\n".utf8))
    exit(2)
}
let file = URL(fileURLWithPath: args[2])
let pasteboard = NSPasteboard.general

if args[1] == "save" {
    // [[type: data]], one dictionary per pasteboard item.
    let items: [[String: Data]] = (pasteboard.pasteboardItems ?? []).map { item in
        var types: [String: Data] = [:]
        for type in item.types {
            if let data = item.data(forType: type) { types[type.rawValue] = data }
        }
        return types
    }
    let data = try PropertyListSerialization.data(fromPropertyList: items, format: .binary, options: 0)
    try data.write(to: file)
} else {
    let data = try Data(contentsOf: file)
    let items = try PropertyListSerialization.propertyList(from: data, format: nil) as? [[String: Data]] ?? []
    pasteboard.clearContents()
    let restored: [NSPasteboardItem] = items.map { types in
        let item = NSPasteboardItem()
        for (type, value) in types { item.setData(value, forType: NSPasteboard.PasteboardType(type)) }
        return item
    }
    if !restored.isEmpty { pasteboard.writeObjects(restored) }
}
