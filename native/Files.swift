import AppKit
import CryptoKit
import WebKit

/// Where downloaded conversation files go: a folder the user can change, one subfolder per conversation.
enum FilesFolder {
    private static let key = "FilesFolder"
    static var root: URL {
        get {
            UserDefaults.standard.string(forKey: key).map { URL(fileURLWithPath: $0, isDirectory: true) }
                ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0].appendingPathComponent("gpt-handoff")
        }
        set { UserDefaults.standard.set(newValue.path, forKey: key) }
    }

    static func choose() {
        let panel = NSOpenPanel()
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
        let name = safeLabel(title, limit: 80).replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
        return root.appendingPathComponent(name.isEmpty || name.hasPrefix(".") ? "conversation" : name, isDirectory: true)
    }
}

/// A short-lived link the page itself asked for, seen by the observer.
struct FileLink {
    let url: URL
    let name: String
    let seen: Date
}

/// Downloads files one at a time through the chat's own WebKit session (no credentials are read or
/// copied) and reports each local path and SHA-256, or why it failed.
final class FileFetcher: NSObject, WKDownloadDelegate {
    struct Outcome {
        let path: URL?
        let sha256: String?
        let problem: String?
    }

    private let web: WKWebView
    private var queue: [(link: FileLink, folder: URL)] = []
    private var outcomes: [Outcome] = []
    private var current: URL?
    private var active: WKDownload?
    private var done: (([Outcome]) -> Void)?

    init(web: WKWebView) { self.web = web }

    func fetch(_ links: [FileLink], into folder: URL, completion: @escaping ([Outcome]) -> Void) {
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        catch { return completion(links.map { _ in Outcome(path: nil, sha256: nil, problem: "the files folder is not writable") }) }
        queue = links.map { ($0, folder) }
        outcomes = []
        done = completion
        next()
    }

    private func next() {
        guard !queue.isEmpty else { let finish = done; done = nil; finish?(outcomes); return }
        let (link, folder) = queue[0]
        current = unique(folder.appendingPathComponent(link.name.isEmpty ? "file" : safeLabel(link.name, limit: 120)
            .replacingOccurrences(of: "/", with: "-")))
        web.startDownload(using: URLRequest(url: link.url)) { [weak self] download in
            self?.active = download
            download.delegate = self
        }
    }

    private func unique(_ url: URL) -> URL {
        var candidate = url, index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
            candidate = url.deletingLastPathComponent().appendingPathComponent("\(base) \(index)" + (ext.isEmpty ? "" : ".\(ext)"))
            index += 1
        }
        return candidate
    }

    private func finish(_ outcome: Outcome) {
        active = nil
        outcomes.append(outcome)
        queue.removeFirst()
        next()
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard download === active else { return completionHandler(nil) }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            completionHandler(nil)
            return finish(Outcome(path: nil, sha256: nil, problem: "the link expired; open the file once in the chat"))
        }
        completionHandler(current)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard download === active else { return }
        guard let path = current, let data = try? Data(contentsOf: path, options: .mappedIfSafe) else {
            return finish(Outcome(path: nil, sha256: nil, problem: "the download could not be read"))
        }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        finish(Outcome(path: path, sha256: hash, problem: nil))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard download === active else { return }
        finish(Outcome(path: nil, sha256: nil, problem: "the download failed; open the file once in the chat"))
    }
}
