import Foundation
import CryptoKit

final class FakeComposer: NativeComposerBackend {
    var trusted = true
    var selected = false
    var writes: [String] = []
    func requestAccess() {}
    func discover() -> [[String: String]] { [["id": "window-one", "app": "Synthetic Agent", "window": "Fixture composer"]] }
    func select(_ id: String) -> String? { selected = id == "window-one"; return selected ? "Synthetic Agent" : nil }
    func clear() { selected = false }
    func append(_ text: String, valid: @escaping () -> Bool, revalidate: @escaping (@escaping (Bool) -> Void) -> Void,
                completion: @escaping (String, Bool) -> Void) {
        revalidate { current in
            if current && valid() && self.selected { self.writes.append(text); completion("Synthetic append verified", true) }
            else { completion("Synthetic append refused", false) }
        }
    }
}
@main enum NativeHostTests {
    static func main() throws {
        var checks = 0
        func check(_ condition: Bool, _ message: String) throws {
            guard condition else { throw NSError(domain: message, code: 1) }; checks += 1
        }
        let backend = FakeComposer()
        var output: [[String: Any]] = []
        let session = NativeHostSession(backend: backend) { output.append($0) }
        func choose() -> String {
            session.receive(["id": UUID().uuidString, "command": "select", "targetId": "window-one"])
            return output.last!["targetToken"] as! String
        }
        let text = "Synthetic **context** 中文 ✓\n"
        let hash = SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        func append(_ id: String, token: String) { session.receive(["id": id, "command": "append", "targetToken": token, "revision": "source-revision", "hash": hash, "text": text]) }
        func permit(_ event: [String: Any], current: Bool = true, ticket: String? = nil) {
            session.receive(["command": "source-permit", "operationId": event["operationId"]!, "ticket": ticket ?? event["ticket"] as! String, "revision": event["revision"]!, "hash": event["hash"]!, "current": current])
        }
        append("no-target", token: "unknown")
        try check(backend.writes.isEmpty && output.last?["ok"] as? Bool == false, "opaque target required")
        append("first", token: choose())
        let first = output.last!
        try check(first["event"] as? String == "source-check" && backend.writes.isEmpty, "no write before final source permit")
        permit(first, ticket: "incorrect-ticket")
        try check(backend.writes.isEmpty, "wrong ticket rejected")
        permit(first)
        try check(backend.writes == [text] && output.last?["inserted"] as? Bool == true, "exact permitted append")
        permit(first)
        try check(backend.writes.count == 1, "permit cannot replay")
        append("changed", token: choose()); let changed = output.last!; permit(changed, current: false)
        try check(backend.writes.count == 1 && output.last?["inserted"] as? Bool == false, "source change refused")
        append("cancelled", token: choose()); let cancelled = output.last!
        session.receive(["id": "cancel-action", "command": "cancel"]); permit(cancelled)
        try check(backend.writes.count == 1, "cancel revokes permit and target")
        append("timeout", token: choose())
        RunLoop.current.run(until: Date().addingTimeInterval(1.05))
        try check(backend.writes.count == 1 && output.last?["inserted"] as? Bool == false, "missing source permit expires")
        append("disconnect", token: choose()); let disconnected = output.last!; session.disconnect(); permit(disconnected)
        try check(backend.writes.count == 1, "disconnect refuses pending write")
        try check(!output.contains { $0["text"] != nil || $0["draft"] != nil }, "responses never echo context or target draft")
        let pipe = Pipe()
        try NativeFrames.write(["id": "roundtrip", "text": text], to: pipe.fileHandleForWriting)
        let decoded = try NativeFrames.read(from: pipe.fileHandleForReading)
        try check(decoded?["text"] as? String == text, "UTF-8 length-framed roundtrip")
        try pipe.fileHandleForWriting.close()
        try check(try NativeFrames.read(from: pipe.fileHandleForReading) == nil, "clean EOF")
        for bytes in [Data([0,0,0,0]), Data([255,255,255,255]), Data([5,0,0,0,123]), Data([2,0,0,0,91,93])] {
            let bad = Pipe(); try bad.fileHandleForWriting.write(contentsOf: bytes); try bad.fileHandleForWriting.close()
            var rejected = false
            do { _ = try NativeFrames.read(from: bad.fileHandleForReading) } catch { rejected = true }
            try check(rejected, "malformed/truncated/oversize frame rejected")
        }
        print("PASS native host protocol: \(checks) checks; composer writes synthetic")
    }
}
