import Foundation
import WebKit

/// One explicit export request, bound to a frozen source. Uses the webview's normal download session.
final class ContextDownloads: NSObject, WKDownloadDelegate {
    typealias Starter = (URLRequest, @escaping (WKDownload) -> Void) -> Void
    private let startDownload: Starter
    private let isCurrent: () -> Bool
    private let progress: (Int, Int) -> Void
    private let completion: ([ContextFile], [String: String]) -> Void
    private let resolveURL: ([String: Any]) -> URL?
    private var references: [[String: Any]]
    private var index = 0
    private var attempts = 0
    private var requestID = UUID()
    private var files: [ContextFile] = []
    private var failures: [String: String] = [:]
    private var current: [String: Any]?
    private var active: WKDownload?
    private var directory: URL?
    private var destination: URL?
    private var receivedName = ""
    private var receivedType = ""
    private var timer: Timer?
    private var observation: NSKeyValueObservation?
    private var ended = false

    init(references: [[String: Any]], startDownload: @escaping Starter, isCurrent: @escaping () -> Bool,
         progress: @escaping (Int, Int) -> Void, completion: @escaping ([ContextFile], [String: String]) -> Void,
         resolveURL: @escaping ([String: Any]) -> URL? = ContextFile.downloadURL) {
        self.references = references; self.startDownload = startDownload; self.isCurrent = isCurrent
        self.progress = progress; self.completion = completion; self.resolveURL = resolveURL
    }
    func start() { next() }
    func cancel() {
        guard !ended else { return }
        ended = true
        let old = active
        active = nil
        old?.cancel { _ in }
        cleanTemporary()
        files = []
    }
    deinit { timer?.invalidate(); if let directory { try? FileManager.default.removeItem(at: directory) } }
    private func cleanTemporary() {
        timer?.invalidate(); timer = nil; observation = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil; destination = nil
    }
    private func next() {
        guard !ended else { return }
        guard isCurrent() else { cancel(); return }
        cleanTemporary()
        requestID = UUID()
        active = nil; current = nil
        while index < references.count {
            let reference = references[index]
            index += 1
            let id = reference["id"] as? String ?? ""
            guard attempts < 10, files.reduce(0, { $0 + $1.bytes.count }) < ContextFile.maximumTotalBytes else {
                failures[id] = "The export file limit was reached."
                continue
            }
            guard let url = resolveURL(reference) else {
                failures[id] = "No supported downloadable file was exposed by the source."
                continue
            }
            current = reference
            attempts += 1
            let operation = requestID
            timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
                guard let self, self.requestID == operation else { return }
                self.fail("The download timed out. Reopen the source file to retry.")
            }
            progress(index, references.count)
            // No custom headers, bearer tokens or page refresh. WebKit owns ordinary authentication.
            startDownload(URLRequest(url: url)) { [weak self] download in
                guard let self, !self.ended, self.requestID == operation, self.isCurrent() else { download.cancel { _ in }; return }
                guard download.originalRequest?.url == url else {
                    download.cancel { _ in }
                    self.fail("The download did not match the selected source file.")
                    return
                }
                self.active = download
                download.delegate = self
                self.observation = download.progress.observe(\.completedUnitCount) { [weak self] progress, _ in
                    if progress.completedUnitCount > ContextFile.maximumBytes {
                        DispatchQueue.main.async {
                            guard let self, self.requestID == operation else { return }
                            self.fail("The download exceeds the 5 MiB file limit.")
                        }
                    }
                }
            }
            return
        }
        ended = true
        completion(files, failures)
        files = []
    }
    private func fail(_ message: String) {
        guard !ended else { return }
        if let id = current?["id"] as? String { failures[id] = message }
        let old = active
        active = nil
        old?.cancel { _ in }
        next()
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard download === active, !ended, isCurrent(), let current else { completionHandler(nil); return }
        let type = response.mimeType?.lowercased() ?? ""
        let name = suggestedFilename
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.expectedContentLength <= ContextFile.maximumBytes,
              ContextFile.acceptsType(type, name: name) else {
            completionHandler(nil)
            fail("The source returned an unsupported file, sign-in page or oversized response.")
            return
        }
        if let expected = current["size"] as? Int, response.expectedContentLength >= 0,
           response.expectedContentLength != expected {
            completionHandler(nil); fail("The downloaded size does not match the source reference."); return
        }
        do {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("handoff-download-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            directory = root
            destination = root.appendingPathComponent("payload")
            receivedName = name; receivedType = type
            completionHandler(destination)
        } catch {
            completionHandler(nil); fail("A temporary download file could not be created.")
        }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        guard download === active, !ended else { decisionHandler(.cancel); return }
        guard isCurrent(), let url = request.url,
              url.scheme == "https", url.user == nil, url.password == nil else {
            decisionHandler(.cancel); fail("The source download redirected to an unsupported location."); return
        }
        decisionHandler(.allow)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard download === active, !ended else { return }
        guard isCurrent() else { cancel(); return }
        guard let current, let destination else { fail("The completed download has no destination."); return }
        do {
            let handle = try FileHandle(forReadingFrom: destination)
            defer { try? handle.close() }
            let bytes = try handle.read(upToCount: ContextFile.maximumBytes + 1) ?? Data()
            let file = try ContextFile(reference: current, name: receivedName, mediaType: receivedType, bytes: bytes)
            guard files.reduce(0, { $0 + $1.bytes.count }) + bytes.count <= ContextFile.maximumTotalBytes else {
                throw ContextFileError(message: "The exported files exceed the 10 MiB total limit.")
            }
            files.append(file)
            next()
        } catch let error as ContextFileError { fail(error.message) }
        catch { fail("The completed download could not be read and verified.") }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard download === active else { return }
        fail("Download interrupted. Reopen the source file to retry.")
    }
}
