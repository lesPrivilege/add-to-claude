import Foundation

@main enum ContextExportTests {
    static func main() throws {
        var checks = 0
        func check(_ condition: Bool, _ message: String) throws {
            guard condition else { throw ContextFileError(message: "FAIL: " + message) }
            checks += 1
        }
        func rejects(_ operation: () throws -> Void) throws {
            do { try operation() } catch { checks += 1; return }
            throw ContextFileError(message: "FAIL: expected rejection")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("handoff-export-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let reference: [String: Any] = ["id": "file-one", "sourceLocator": "response.mapping.a.message.attachments[0]",
                                       "name": "notes.md", "url": "https://example.com/notes.md", "status": "download-needed"]
        for name in ["../notes.md", ".hidden.txt", "CON.txt", "bad\u{202e}.txt", "bad.txt ", "script.app", "a/b.txt", "e\u{301}.txt"] {
            try check(!ContextFile.acceptsName(name), "unsafe filename: \(name)")
        }
        try check(ContextFile.acceptsName("笔记.md"), "Unicode filename")
        try check(ContextFile.downloadURL(reference)?.scheme == "https", "exposed HTTPS download")
        var invalid = reference
        invalid["url"] = "http://127.0.0.1/secret"
        try check(ContextFile.downloadURL(invalid) == nil, "no loopback source request")
        invalid["url"] = "https://user:password@example.com/file.md"
        try check(ContextFile.downloadURL(invalid) == nil, "no credentials")
        invalid = reference; invalid["status"] = "expired"
        try check(ContextFile.downloadURL(invalid) == nil, "expired source")
        let bytes = Data("**原文** ✓\n".utf8)
        let file = try ContextFile(reference: reference, name: "notes.md", mediaType: "text/markdown", bytes: bytes)
        try rejects { _ = try ContextFile(reference: reference, name: "notes.md", mediaType: "text/html", bytes: bytes) }
        invalid = reference; invalid["sha256"] = String(repeating: "0", count: 64)
        try rejects { _ = try ContextFile(reference: invalid, name: "notes.md", mediaType: "text/markdown", bytes: bytes) }
        invalid = reference; invalid["size"] = bytes.count + 1
        try rejects { _ = try ContextFile(reference: invalid, name: "notes.md", mediaType: "text/markdown", bytes: bytes) }
        try rejects { _ = try ContextFile(reference: reference, name: "notes.md", mediaType: "text/markdown", bytes: Data(count: ContextFile.maximumBytes + 1)) }
        var other = reference; other["id"] = "file-two"; other["sourceLocator"] = "response.mapping.a.message.attachments[1]"
        let second = try ContextFile(reference: other, name: "notes.md", mediaType: "text/markdown", bytes: Data("Second file".utf8))
        var missing = reference; missing["id"] = "file-missing"
        let model: [String: Any] = ["source": ["id": "synthetic-source"], "branches": ["selectedLeaf": "a"],
                                    "verification": ["status": "partial"], "attachments": [reference, other, missing]]
        let markdown = "# Synthetic long context\n" + String(repeating: "原文 **Markdown** ✓\n", count: 150_000)
        let output = try ContextExport.write(markdown: markdown, model: model, files: [file, second], failures: ["file-missing": "Source file expired."], parent: root)
        let saved = try String(contentsOf: output.appendingPathComponent("context.md"), encoding: .utf8)
        try check(saved.hasPrefix(markdown), "full >2 MiB Unicode text, no truncation")
        try check(saved.contains("Nothing was attached") && saved.contains("Unresolved files: 1"), "truthful export status")
        let firstBytes = try Data(contentsOf: output.appendingPathComponent("files/1-notes.md"))
        let secondBytes = try Data(contentsOf: output.appendingPathComponent("files/2-notes.md"))
        try check(firstBytes == bytes && secondBytes == second.bytes, "same-name source files remain distinct")
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: output.appendingPathComponent("manifest.json"))) as! [String: Any]
        let results = manifest["attachmentResults"] as! [[String: Any]]
        try check(results[0]["sha256"] as? String == file.sha256 && results[2]["status"] as? String == "unavailable", "actual hash and missing receipt")
        let source = try JSONSerialization.jsonObject(with: Data(contentsOf: output.appendingPathComponent("conversation.json"))) as! [String: Any]
        try check((source["verification"] as? [String: String])?["status"] == "partial", "source uncertainty preserved")
        var wrong = model; wrong["attachments"] = [missing]
        try rejects { _ = try ContextExport.write(markdown: markdown, model: wrong, files: [file], failures: [:], parent: root) }
        try rejects { _ = try ContextExport.write(markdown: markdown, model: model, files: [file, file], failures: [:], parent: root) }
        try rejects { _ = try ContextExport.write(markdown: markdown, model: model, files: [], failures: [:], parent: root.appendingPathComponent("absent")) }
        for stopAt in [1, 3, 6, 7] {
            var checkpoints = 0
            try rejects {
                _ = try ContextExport.write(markdown: markdown, model: model, files: [file], failures: [:], parent: root,
                    isCancelled: { checkpoints += 1; return checkpoints >= stopAt })
            }
        }
        let entries = try FileManager.default.contentsOfDirectory(atPath: root.path)
        try check(entries.count == 1 && !entries.contains(where: { $0.hasPrefix(".handoff") }), "failed exports leave no partial context")
        print("PASS native context export: \(checks) checks")
    }
}
