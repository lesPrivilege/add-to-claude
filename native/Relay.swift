import Foundation
import Darwin

/// The app connection, shared by the reading and writing threads.
private final class Current: @unchecked Sendable {
    private let lock = NSLock()
    private var handle: FileHandle?
    var app: FileHandle? {
        get { lock.lock(); defer { lock.unlock() }; return handle }
        set { lock.lock(); handle = newValue; lock.unlock() }
    }
}

/// Chrome starts this with the caller's origin. It only copies frames between Chrome and the
/// running menu-bar app, and tells the extension whether the app is there. It holds no state.
@main enum Relay {
    static func main() {
        guard CommandLine.arguments.count >= 2, CommandLine.arguments[1] == nativeHostAllowedOrigin else { exit(1) }
        signal(SIGPIPE, SIG_IGN)
        let path = linkSocketPath()
        let current = Current()
        // Serve only the app installed beside this relay, never another process on the socket.
        let expected = Bundle.main.executableURL!.resolvingSymlinksInPath()
            .deletingLastPathComponent().appendingPathComponent("gpt-handoff").path

        Thread.detachNewThread {
            while true {
                guard let packet = try? Frames.read(from: .standardInput) else { exit(0) }
                if let app = current.app { try? Frames.write(packet, to: app) }
            }
        }

        // Chrome accepts at most 1 MiB per message from a native host.
        func toChrome(_ packet: [String: Any]) {
            do { try Frames.write(packet, to: .standardOutput, limit: 1024 * 1024) } catch { exit(0) }
        }
        while true {
            guard let connected = connectLink(path) else { Thread.sleep(forTimeInterval: 1); continue }
            guard peerExecutable(connected.fileDescriptor) == expected else {
                try? connected.close(); Thread.sleep(forTimeInterval: 1); continue
            }
            current.app = connected
            toChrome(["event": "app", "connected": true])
            while let packet = try? Frames.read(from: connected) { toChrome(packet) }
            current.app = nil
            toChrome(["event": "app", "connected": false])
            Thread.sleep(forTimeInterval: 1)
        }
    }
}
