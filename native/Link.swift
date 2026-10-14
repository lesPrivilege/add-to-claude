import Foundation
import Darwin

/// Length-prefixed JSON, the framing Chrome uses for native messaging. Never emit unframed bytes.
enum Frames {
    static let maximum = 64 * 1024 * 1024

    static func read(from handle: FileHandle) throws -> [String: Any]? {
        func exact(_ count: Int, allowEOF: Bool = false) throws -> Data? {
            var bytes = Data()
            while bytes.count < count {
                let next = try handle.read(upToCount: count - bytes.count) ?? Data()
                if next.isEmpty {
                    if allowEOF && bytes.isEmpty { return nil }
                    throw NSError(domain: "Frames", code: 1)
                }
                bytes.append(next)
            }
            return bytes
        }
        guard let header = try exact(4, allowEOF: true) else { return nil }
        let size = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
        guard size > 0, size <= maximum, let body = try exact(Int(size)),
              let packet = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw NSError(domain: "Frames", code: 2)
        }
        return packet
    }

    static func write(_ packet: [String: Any], to handle: FileHandle, limit: Int = maximum) throws {
        let body = try JSONSerialization.data(withJSONObject: packet)
        guard body.count <= limit else { throw NSError(domain: "Frames", code: 3) }
        let size = UInt32(body.count)
        try handle.write(contentsOf: Data((0..<4).map { UInt8((size >> ($0 * 8)) & 255) }) + body)
    }
}

/// One per-user socket in the user's private temporary directory joins the relay to the app.
func linkSocketPath() -> String {
    #if GPT_HANDOFF_TEST
    // Test builds only, so release binaries cannot be pointed at another socket through the environment.
    if let path = ProcessInfo.processInfo.environment["GPT_HANDOFF_SOCKET"], path.hasPrefix("/") { return path }
    #endif
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
    confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, buffer.count)
    return String(cString: buffer) + "gpt-handoff.sock"
}

private func address(_ path: String) -> sockaddr_un? {
    var result = sockaddr_un()
    result.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: result.sun_path) else { return nil }
    withUnsafeMutableBytes(of: &result.sun_path) { raw in
        raw.copyBytes(from: bytes)
        raw[bytes.count] = 0
    }
    return result
}

private func unixSocket() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    var on: Int32 = 1
    if fd >= 0 { setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size)) }
    return fd
}

func connectLink(_ path: String) -> FileHandle? {
    guard var target = address(path) else { return nil }
    let fd = unixSocket()
    guard fd >= 0 else { return nil }
    let connected = withUnsafePointer(to: &target) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard connected == 0 else { close(fd); return nil }
    return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
}

/// Nil when another live process already serves this path; a stale file is replaced.
func listenLink(_ path: String) -> Int32? {
    guard var target = address(path), connectLink(path) == nil else { return nil }
    unlink(path)
    let fd = unixSocket()
    guard fd >= 0 else { return nil }
    let bound = withUnsafePointer(to: &target) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
    }
    guard bound == 0, chmod(path, 0o600) == 0, listen(fd, 4) == 0 else { close(fd); return nil }
    return fd
}

/// The executable on the other end of a connected Unix socket.
func peerExecutable(_ fd: Int32) -> String? {
    var pid: pid_t = 0
    var size = socklen_t(MemoryLayout<pid_t>.size)
    guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0, pid > 0 else { return nil }
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
    return URL(fileURLWithPath: String(cString: buffer)).resolvingSymlinksInPath().path
}

/// App side of the link. Accepts only the bundled relay, keeps one connection, and matches replies by id.
final class ChromeLink {
    /// The latest extension state, or nil when Chrome is not connected.
    var onState: ([String: Any]?) -> Void = { _ in }
    private let path: String
    private let allowedPeer: String?
    private var connection: FileHandle?
    private var pending: [String: ([String: Any]?) -> Void] = [:]

    init(path: String = linkSocketPath(), allowedPeer: String?) {
        self.path = path
        self.allowedPeer = allowedPeer
    }

    func start() -> Bool {
        guard let server = listenLink(path) else { return false }
        Thread.detachNewThread { [weak self] in
            while true {
                let client = accept(server, nil, nil)
                guard client >= 0 else {
                    if errno == EBADF || errno == EINVAL { return }
                    Thread.sleep(forTimeInterval: 0.05); continue
                }
                guard let self else { close(client); return }
                if let allowed = self.allowedPeer, peerExecutable(client) != allowed { close(client); continue }
                var on: Int32 = 1
                setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
                let handle = FileHandle(fileDescriptor: client, closeOnDealloc: true)
                DispatchQueue.main.async { self.adopt(handle) }
            }
        }
        return true
    }

    /// One Chrome at a time: a second relay (another profile or channel) is refused, not swapped in.
    private func adopt(_ handle: FileHandle) {
        guard connection == nil else { try? handle.close(); return }
        connection = handle
        Thread.detachNewThread { [weak self] in
            while let packet = try? Frames.read(from: handle) {
                DispatchQueue.main.async { self?.receive(packet, from: handle) }
            }
            DispatchQueue.main.async { if self?.connection === handle { self?.drop() } }
        }
    }

    private func drop() {
        guard let old = connection else { return }
        connection = nil
        shutdown(old.fileDescriptor, SHUT_RDWR) // Wakes the reader thread before the descriptor closes.
        try? old.close()
        let waiting = pending
        pending = [:]
        waiting.values.forEach { $0(nil) }
        onState(nil)
    }

    private func receive(_ packet: [String: Any], from handle: FileHandle) {
        guard handle === connection else { return }
        if packet["event"] as? String == "state" { onState(packet["state"] as? [String: Any]); return }
        if let id = packet["id"] as? String, let reply = pending.removeValue(forKey: id) { reply(packet) }
    }

    /// Completes on the main queue with the reply, or nil when disconnected or timed out.
    func request(_ command: String, _ values: [String: Any] = [:], timeout: TimeInterval = 5,
                 completion: @escaping ([String: Any]?) -> Void) {
        let id = UUID().uuidString
        guard let connection, (try? Frames.write(values.merging(["id": id, "command": command]) { _, new in new }, to: connection)) != nil else {
            completion(nil); return
        }
        pending[id] = completion
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.pending.removeValue(forKey: id)?(nil)
        }
    }
}
