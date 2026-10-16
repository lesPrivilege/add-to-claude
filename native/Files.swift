import AppKit
import CryptoKit
import WebKit

/// Dialogs open above the floating chat panel instead of behind it.
let aboveChatPanel = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)

/// Where downloaded conversation files go: a folder the user can change, one subfolder per conversation.
enum FilesFolder {
    private static let key = "FilesFolder"
    static var root: URL {
        get {
            UserDefaults.standard.string(forKey: key).map { URL(fileURLWithPath: $0, isDirectory: true) }
                ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0].appendingPathComponent("Add to Claude")
        }
        set { UserDefaults.standard.set(newValue.path, forKey: key) }
    }

    static func choose() {
        let panel = NSOpenPanel()
        panel.level = aboveChatPanel
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.directoryURL = root
        panel.prompt = "Use Folder"
        panel.message = "Files from a conversation are saved in a subfolder here when you add it."
        NSApp.activate()
        if panel.runModal() == .OK, let url = panel.url { root = url }
    }

    static func folder(for title: String) -> URL {
        root.appendingPathComponent(safeFileName(String(title.prefix(80)), fallback: "conversation"), isDirectory: true)
    }
}

/// A file name that stays inside its folder: no separators, never `.`, `..` or hidden.
func safeFileName(_ raw: String, fallback: String = "file") -> String {
    let name = safeLabel(raw, limit: 120).replacingOccurrences(of: "/", with: "-")
        .replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
    if name.isEmpty || name == "." || name == ".." { return fallback }
    return name.hasPrefix(".") ? "_" + name.dropFirst() : name
}

/// The first free name in `folder`: `name`, then `name 2`, `name 3`…
func freePath(in folder: URL, for name: String) -> URL {
    let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
    var candidate = folder.appendingPathComponent(name), index = 2
    while FileManager.default.fileExists(atPath: candidate.path) {
        candidate = folder.appendingPathComponent("\(base) \(index)" + (ext.isEmpty ? "" : ".\(ext)"))
        index += 1
    }
    return candidate
}

/// A file just saved as "name 2.ext" because "name.ext" was there: when both hold the same bytes
/// (the same file downloaded again), keep the earlier one and remove the new copy.
func reuseIdentical(_ path: URL, sha256 hash: String, name: String) -> URL {
    let earlier = path.deletingLastPathComponent().appendingPathComponent(name)
    guard earlier.standardizedFileURL != path.standardizedFileURL, sha256(of: earlier) == hash else { return path }
    try? FileManager.default.removeItem(at: path)
    return earlier
}

func sha256(of path: URL) -> String? {
    guard let data = try? Data(contentsOf: path, options: .mappedIfSafe) else { return nil }
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// A short-lived link the page itself asked for, seen by the observer.
struct FileLink {
    let url: URL
    let name: String
    let seen: Date
    /// The conversation page the link was fetched on: a link is only ever used for that conversation.
    var page: String = ""
}

/// The link for a file among those the page fetched: by file id and message, then by file id, then by
/// name when the name is unique in the conversation. Only fresh links fetched on this conversation's
/// page count, since sandbox paths and names repeat across conversations.
func chooseLink(_ links: [String: FileLink], for file: Attachment, on page: String, nameIsUnique: Bool,
                now: Date = Date()) -> FileLink? {
    let fresh = links.filter { $0.value.page == page && now.timeIntervalSince($0.value.seen) < 240 }
    if let link = fresh[file.id + "|" + file.messageId] ?? fresh[file.id + "|"] { return link }
    guard nameIsUnique else { return nil }
    return fresh.values.filter { $0.name == file.name }.max { $0.seen < $1.seen }
}

/// Downloads files one at a time through the chat's own WebKit session (no credentials are read or
/// copied) and reports each local path and SHA-256, or why it failed. Batches queue behind each other,
/// and a download that stalls for two minutes is cancelled.
final class FileFetcher: NSObject, WKDownloadDelegate {
    struct Item {
        let key: String
        let link: FileLink
    }
    struct Outcome {
        let path: URL?
        let sha256: String?
        let problem: String?
    }
    private struct Batch {
        let items: [Item]
        let folder: URL
        let done: ([String: Outcome]) -> Void
    }

    private let web: WKWebView
    private var batches: [Batch] = []
    private var index = 0
    private var outcomes: [String: Outcome] = [:]
    private var current: URL?
    private var active: WKDownload?
    private var attempt = 0

    init(web: WKWebView) { self.web = web }

    func fetch(_ items: [Item], into folder: URL, completion: @escaping ([String: Outcome]) -> Void) {
        batches.append(Batch(items: items, folder: folder, done: completion))
        if batches.count == 1 { start() }
    }

    private func start() {
        guard let batch = batches.first else { return }
        index = 0
        outcomes = [:]
        do { try FileManager.default.createDirectory(at: batch.folder, withIntermediateDirectories: true) }
        catch {
            for item in batch.items { outcomes[item.key] = Outcome(path: nil, sha256: nil, problem: "the files folder is not writable") }
            return endBatch()
        }
        next()
    }

    private func next() {
        guard let batch = batches.first else { return }
        guard index < batch.items.count else { return endBatch() }
        let item = batch.items[index]
        current = freePath(in: batch.folder, for: safeFileName(item.link.name))
        attempt += 1
        let this = attempt
        web.startDownload(using: URLRequest(url: item.link.url)) { [weak self] download in
            self?.active = download
            download.delegate = self
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            guard let self, self.attempt == this, self.active != nil else { return }
            self.active?.cancel { _ in }
            self.finish(Outcome(path: nil, sha256: nil, problem: "the download stalled"))
        }
    }

    private func endBatch() {
        let batch = batches.removeFirst()
        batch.done(outcomes)
        start()
    }

    private func finish(_ outcome: Outcome) {
        guard let batch = batches.first, index < batch.items.count else { return }
        active = nil
        outcomes[batch.items[index].key] = outcome
        index += 1
        next()
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard download === active else { return completionHandler(nil) }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            completionHandler(nil)
            return finish(Outcome(path: nil, sha256: nil, problem: "the link expired; try again"))
        }
        completionHandler(current)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard download === active else { return }
        guard let path = current, let hash = sha256(of: path), let batch = batches.first, index < batch.items.count else {
            return finish(Outcome(path: nil, sha256: nil, problem: "the download could not be read"))
        }
        finish(Outcome(path: reuseIdentical(path, sha256: hash, name: safeFileName(batch.items[index].link.name)),
                       sha256: hash, problem: nil))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard download === active else { return }
        finish(Outcome(path: nil, sha256: nil, problem: "the download failed"))
    }
}
