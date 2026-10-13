import AppKit
import WebKit

final class DownloadRunner: NSObject, NSApplicationDelegate {
    var view: WKWebView!
    var batch: ContextDownloads?
    var index = 0
    let paths = ["ok", "html", "oversize", "mismatch", "redirect", "interrupted"]
    var baseline = Set<String>()
    var finished = false
    let port = CommandLine.arguments[1]
    func temporaryNames() -> Set<String> {
        Set((try? FileManager.default.contentsOfDirectory(atPath: FileManager.default.temporaryDirectory.path))?.filter { $0.hasPrefix("handoff-download-") } ?? [])
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        view = WKWebView(frame: .zero, configuration: configuration)
        baseline = temporaryNames()
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { self.end(false, "Native download tests timed out") }
        runNext()
    }
    func end(_ success: Bool, _ message: String) {
        guard !finished else { return }
        finished = true
        batch?.cancel()
        print(message); fflush(stdout); exit(success ? 0 : 1)
    }
    func reference(_ path: String, id: String = "fixture-file") -> [String: Any] {
        ["id": id, "name": "notes.md", "sourceLocator": "synthetic:\(id)", "status": "download-needed", "url": "http://127.0.0.1:\(port)/\(path)"]
    }
    func create(_ refs: [[String: Any]], isCurrent: @escaping () -> Bool = { true }, completion: @escaping ([ContextFile], [String: String]) -> Void) -> ContextDownloads {
        var seen: [WKDownload] = []
        return ContextDownloads(references: refs, startDownload: { [weak self] request, callback in
            self?.view.startDownload(using: request) { download in
                callback(download)
                if let stale = seen.first {
                    let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil, headerFields: nil)!
                    self?.batch?.download(stale, willPerformHTTPRedirection: response, newRequest: request) { policy in
                        if policy != .cancel { self?.end(false, "Stale redirect allowed") }
                    }
                }
                seen.append(download)
            }
        }, isCurrent: isCurrent, progress: { _, _ in }, completion: completion,
        // Eligibility injection is fixture-only. Production rejects HTTP/loopback references.
        resolveURL: { URL(string: $0["url"] as! String) })
    }
    func runNext() {
        if index == paths.count { runCancellation(); return }
        let path = paths[index]
        var ref = reference(path)
        if path == "mismatch" { ref["size"] = 1000 }
        let refs = path == "ok" ? [ref, reference("ok", id: "same-name-second")] : [ref]
        let next = create(refs) { files, failures in
            if path == "ok" {
                guard files.count == 2, failures.isEmpty,
                      files.allSatisfy({ String(data: $0.bytes, encoding: .utf8) == "Synthetic **download** 中文 ✓\n" }) else {
                    self.end(false, "FAIL exact native download bytes: \(files.count), \(failures)"); return
                }
            } else if !files.isEmpty || failures.count != 1 {
                self.end(false, "FAIL rejection for \(path)"); return
            }
            self.index += 1
            DispatchQueue.main.async { self.runNext() }
        }
        batch = next; next.start()
    }
    func runCancellation() {
        let next = create([reference("slow")]) { _, _ in self.end(false, "Cancelled download delivered a result") }
        batch = next; next.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { next.cancel() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.runSourceChange() }
    }
    func runSourceChange() {
        var current = true
        let next = create([reference("slow")], isCurrent: { current }) { _, _ in self.end(false, "Stale source delivered file bytes") }
        batch = next; next.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03) { current = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            next.cancel()
            guard self.temporaryNames().subtracting(self.baseline).isEmpty else { self.end(false, "Temporary download files leaked"); return }
            self.end(true, "PASS native WebKit downloads: exact bytes/same-name ownership/stale redirect, HTML refusal, chunked oversize, size mismatch, unsafe redirect, interrupted transfer, cancellation, stale source/cleanup (8 scenarios)")
        }
    }
}
@main enum Main {
    static func main() {
        let app = NSApplication.shared
        let runner = DownloadRunner()
        app.delegate = runner
        app.setActivationPolicy(.prohibited)
        app.run()
    }
}
