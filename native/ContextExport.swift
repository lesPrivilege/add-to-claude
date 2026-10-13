import Foundation
import CryptoKit

struct ContextFileError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class ContextExportCancellation {
    private let lock = NSLock()
    private var stopped = false
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}

struct ContextFile {
    static let maximumBytes = 5 * 1024 * 1024
    static let maximumTotalBytes = 10 * 1024 * 1024
    static let types: [String: Set<String>] = [
        "txt": ["text/plain"], "md": ["text/markdown", "text/plain"],
        "json": ["application/json", "text/plain"], "csv": ["text/csv", "text/plain"],
        "pdf": ["application/pdf"], "png": ["image/png"],
        "jpg": ["image/jpeg"], "jpeg": ["image/jpeg"], "webp": ["image/webp"]
    ]
    let attachmentID: String
    let sourceLocator: String
    let originalURL: String
    let name: String
    let mediaType: String
    let bytes: Data
    var sha256: String { Self.digest(bytes) }

    static func digest(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
    static func acceptsName(_ name: String) -> Bool {
        guard !name.isEmpty, name.utf8.count <= 180,
              name.utf8.elementsEqual(name.precomposedStringWithCanonicalMapping.utf8),
              !name.hasPrefix("."), !name.hasSuffix("."), !name.hasSuffix(" "),
              name.range(of: #"[\\/:*?"<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]"#, options: .regularExpression) == nil,
              name.range(of: #"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)"#, options: [.regularExpression, .caseInsensitive]) == nil else { return false }
        return types[(name as NSString).pathExtension.lowercased()] != nil
    }
    static func acceptsType(_ type: String, name: String) -> Bool {
        acceptsName(name) && types[(name as NSString).pathExtension.lowercased()]?.contains(type.lowercased()) == true
    }
    static func downloadURL(_ attachment: [String: Any]) -> URL? {
        guard attachment["status"] as? String == "download-needed",
              let name = attachment["name"] as? String, acceptsName(name),
              let raw = attachment["url"] as? String, raw.utf8.count <= 8192,
              let url = URL(string: raw), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil,
              (attachment["size"] as? Int ?? 0) <= maximumBytes else { return nil }
        return url
    }
    init(reference: [String: Any], name: String, mediaType: String, bytes: Data) throws {
        guard let id = reference["id"] as? String, let locator = reference["sourceLocator"] as? String,
              let url = reference["url"] as? String, Self.acceptsType(mediaType, name: name),
              bytes.count <= Self.maximumBytes else {
            throw ContextFileError(message: "The downloaded file has unsupported metadata, type or size.")
        }
        if let size = reference["size"] as? Int, size != bytes.count {
            throw ContextFileError(message: "The downloaded size does not match the source reference.")
        }
        if let expected = reference["sha256"] as? String, expected != Self.digest(bytes) {
            throw ContextFileError(message: "The downloaded file does not match the recorded fingerprint.")
        }
        attachmentID = id; sourceLocator = locator; originalURL = url
        self.name = name; self.mediaType = mediaType.lowercased(); self.bytes = bytes
    }
}

/// Explicit user export only. Original source evidence and local-file evidence remain distinct.
enum ContextExport {
    static func write(markdown: String, model: [String: Any], files: [ContextFile],
                      failures: [String: String], parent: URL, isCancelled: () -> Bool = { false }) throws -> URL {
        func checkCancellation() throws {
            if isCancelled() { throw ContextFileError(message: "Export cancelled.") }
        }
        try checkCancellation()
        guard markdown.utf8.count <= 16 * 1024 * 1024,
              let references = model["attachments"] as? [[String: Any]],
              files.count <= 10, files.reduce(0, { $0 + $1.bytes.count }) <= ContextFile.maximumTotalBytes,
              Set(files.map(\.attachmentID)).count == files.count else {
            throw ContextFileError(message: "This context exceeds the supported export bounds.")
        }
        for file in files {
            guard references.filter({ $0["id"] as? String == file.attachmentID &&
                $0["sourceLocator"] as? String == file.sourceLocator && $0["url"] as? String == file.originalURL }).count == 1 else {
                throw ContextFileError(message: "A downloaded file no longer matches this source.")
            }
        }
        let fm = FileManager.default
        let staging = parent.appendingPathComponent(".handoff-" + UUID().uuidString, isDirectory: true)
        let destination = parent.appendingPathComponent("Handoff-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var committed = false
        defer { if !committed { try? fm.removeItem(at: staging) } }
        let fileDirectory = staging.appendingPathComponent("files", isDirectory: true)
        if !files.isEmpty { try fm.createDirectory(at: fileDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        func write(_ data: Data, to url: URL) throws {
            try checkCancellation()
            try data.write(to: url, options: .withoutOverwriting)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        }
        var results: [[String: Any]] = []
        var links: [String] = []
        for (index, file) in files.enumerated() {
            let name = "\(index + 1)-" + file.name
            try write(file.bytes, to: fileDirectory.appendingPathComponent(name))
            let path = "files/" + name
            results.append(["attachmentId": file.attachmentID, "sourceLocator": file.sourceLocator,
                            "originalURL": file.originalURL, "status": "exported", "path": path,
                            "size": file.bytes.count, "mediaType": file.mediaType, "sha256": file.sha256])
            let label = file.name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]")
            let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
            links.append("- [\(label)](files/\(encoded)) · SHA-256: \(file.sha256)")
        }
        let receivedIDs = Set(files.map(\.attachmentID))
        for reference in references where !receivedIDs.contains(reference["id"] as? String ?? "") {
            let id = reference["id"] as? String ?? ""
            results.append(["attachmentId": id, "sourceLocator": reference["sourceLocator"] ?? "",
                            "status": "unavailable", "message": failures[id] ?? "No supported downloadable file was exposed by the source."])
        }
        // Do not change any original turn text or silently upgrade source verification.
        let appendix = "\n## Exported files\n\nThis folder was saved locally. Nothing was attached to or sent from a target composer.\nOriginal source checks above describe capture; manifest.json records actual exported files.\n\n" +
            (links.isEmpty ? "No attachment bytes were exported.\n" : links.joined(separator: "\n") + "\n") +
            "\nUnresolved files: \(references.count - files.count).\n"
        let context = Data((markdown + appendix).utf8)
        try write(context, to: staging.appendingPathComponent("context.md"))
        try write(try JSONSerialization.data(withJSONObject: model, options: [.prettyPrinted, .sortedKeys]), to: staging.appendingPathComponent("conversation.json"))
        let manifest: [String: Any] = ["format": "gpt-handoff-context", "version": 1,
                                     "delivery": "exported-not-attached", "context": ["path": "context.md", "sha256": ContextFile.digest(context)],
                                     "source": model["source"] ?? [:], "selectedBranch": (model["branches"] as? [String: Any])?["selectedLeaf"] ?? "",
                                     "attachmentResults": results]
        try write(try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]), to: staging.appendingPathComponent("manifest.json"))
        try checkCancellation()
        try fm.moveItem(at: staging, to: destination)
        if isCancelled() {
            try? fm.removeItem(at: destination)
            throw ContextFileError(message: "Export cancelled.")
        }
        committed = true
        return destination
    }
}
