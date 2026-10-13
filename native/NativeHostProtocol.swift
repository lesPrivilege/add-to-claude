import Foundation
import CryptoKit

protocol NativeComposerBackend: AnyObject {
    var trusted: Bool { get }
    func requestAccess()
    func discover() -> [[String: String]]
    func select(_ id: String) -> String?
    func clear()
    func append(_ text: String, valid: @escaping () -> Bool,
                revalidate: @escaping (@escaping (Bool) -> Void) -> Void,
                completion: @escaping (String, Bool) -> Void)
}

/// In-memory protocol. Caller identity is checked by Chrome's manifest and again by the host entry point.
final class NativeHostSession {
    private let backend: NativeComposerBackend
    private let send: ([String: Any]) -> Void
    private var connected = true
    private var targetToken: String?
    private var pending: String?
    private var ticket: String?
    private var permit: ((Bool) -> Void)?
    private var revision: String?
    private var hash: String?
    private var permitGranted = false
    private var permitDeadline: TimeInterval = 0
    init(backend: NativeComposerBackend, send: @escaping ([String: Any]) -> Void) {
        self.backend = backend; self.send = send
    }
    func disconnect() {
        connected = false; pending = nil; ticket = nil
        let callback = permit; permit = nil; callback?(false)
        targetToken = nil; backend.clear()
    }
    private func identifier(_ value: Any?) -> String? {
        guard let text = value as? String, text.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil else { return nil }
        return text
    }
    func receive(_ packet: [String: Any]) {
        guard connected else { return }
        if packet["command"] as? String == "source-permit" {
            guard let operation = identifier(packet["operationId"]), operation == pending,
                  let value = identifier(packet["ticket"]), value == ticket,
                  packet["revision"] as? String == revision, packet["hash"] as? String == hash,
                  ProcessInfo.processInfo.systemUptime <= permitDeadline else { return }
            let callback = permit; permit = nil; ticket = nil
            permitGranted = packet["current"] as? Bool == true
            callback?(permitGranted)
            return
        }
        guard let id = identifier(packet["id"]), let command = packet["command"] as? String else { return }
        func reply(_ values: [String: Any]) { send(values.merging(["id": id]) { _, new in new }) }
        if command == "cancel" {
            pending = nil; ticket = nil
            let callback = permit; permit = nil; callback?(false)
            targetToken = nil; backend.clear()
            reply(["ok": true]); return
        }
        if command == "ping" { reply(["ok": true, "protocol": 1, "trusted": backend.trusted]); return }
        guard pending == nil else { reply(["ok": false, "error": "A handoff is already in progress."]); return }
        switch command {
        case "access":
            backend.requestAccess()
            reply(["ok": true, "trusted": backend.trusted])
        case "targets":
            targetToken = nil; backend.clear()
            reply(["ok": true, "trusted": backend.trusted, "targets": backend.discover()])
        case "select":
            targetToken = nil
            guard let selected = identifier(packet["targetId"]), let name = backend.select(selected) else {
                reply(["ok": false, "error": "Focus a writable composer, then select its window again."]); return
            }
            let token = UUID().uuidString; targetToken = token
            reply(["ok": true, "targetToken": token, "name": name])
        case "append":
            guard backend.trusted, let expected = identifier(packet["targetToken"]), expected == targetToken,
                  let revision = identifier(packet["revision"]), let text = packet["text"] as? String,
                  !text.isEmpty, text.utf8.count <= 2 * 1024 * 1024,
                  let hash = packet["hash"] as? String,
                  hash == SHA256.hash(data: Data(text.utf8)).map({ String(format: "%02x", $0) }).joined() else {
                reply(["ok": false, "error": "Source or target is unavailable, changed or too large."]); return
            }
            pending = id; self.revision = revision; self.hash = hash; permitGranted = false
            backend.append(text, valid: { [weak self] in self?.connected == true && self?.pending == id && self?.targetToken == expected && (self?.permitGranted != true || ProcessInfo.processInfo.systemUptime <= (self?.permitDeadline ?? 0)) }, revalidate: { [weak self] callback in
                guard let self, self.connected, self.pending == id else { callback(false); return }
                let ticket = UUID().uuidString
                self.ticket = ticket; self.permit = callback
                self.permitDeadline = ProcessInfo.processInfo.systemUptime + 1
                self.send(["event": "source-check", "operationId": id, "ticket": ticket, "revision": revision, "hash": hash])
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                    guard let self, self.ticket == ticket else { return }
                    self.ticket = nil
                    let expired = self.permit; self.permit = nil; expired?(false)
                }
            }) { [weak self] message, success in
                guard let self, self.connected else { return }
                if self.pending == id { self.pending = nil; self.targetToken = nil; self.backend.clear() }
                self.send(["id": id, "ok": success, "inserted": success, "message": message])
            }
        default:
            reply(["ok": false, "error": "Unsupported native operation."])
        }
    }
}

/// Chrome native-messaging framing. Never line-split JSON or emit unframed stdout diagnostics.
enum NativeFrames {
    static let maximumInput = 4 * 1024 * 1024
    static let maximumOutput = 1024 * 1024
    static func read(from handle: FileHandle) throws -> [String: Any]? {
        func exact(_ count: Int, allowEOF: Bool = false) throws -> Data? {
            var bytes = Data()
            while bytes.count < count {
                let next = try handle.read(upToCount: count - bytes.count) ?? Data()
                if next.isEmpty {
                    if allowEOF && bytes.isEmpty { return nil }
                    throw NSError(domain: "NativeFrame", code: 1)
                }
                bytes.append(next)
            }
            return bytes
        }
        guard let header = try exact(4, allowEOF: true) else { return nil }
        let size = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
        guard size > 0, size <= maximumInput, let body = try exact(Int(size)),
              let packet = try JSONSerialization.jsonObject(with: body) as? [String: Any] else { throw NSError(domain: "NativeFrame", code: 2) }
        return packet
    }
    static func write(_ packet: [String: Any], to handle: FileHandle) throws {
        let body = try JSONSerialization.data(withJSONObject: packet)
        guard body.count <= maximumOutput else { throw NSError(domain: "NativeFrame", code: 3) }
        let size = UInt32(body.count)
        try handle.write(contentsOf: Data((0..<4).map { UInt8((size >> ($0 * 8)) & 255) }) + body)
    }
}
