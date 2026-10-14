import Foundation
import Darwin

// Exercises the real compiled relay against the app-side link. No Chrome, Accessibility or network.
// This binary is installed as `gpt-handoff` beside the relay, the only server the relay will talk to.
@main enum LinkTests {
    static var checks = 0
    static func check(_ condition: Bool, _ label: String) {
        guard condition else { print("FAIL: \(label)"); exit(1) }
        checks += 1
    }
    static func pump(until done: () -> Bool, _ label: String) {
        let deadline = Date().addingTimeInterval(5)
        while !done() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
        check(done(), label)
    }

    static func outcome(_ handle: FileHandle) -> String {
        do { return try Frames.read(from: handle) == nil ? "end" : "frame" } catch { return "error" }
    }

    static func main() {
        signal(SIGPIPE, SIG_IGN)
        let relay = Bundle.main.executableURL!.resolvingSymlinksInPath()
            .deletingLastPathComponent().appendingPathComponent("gpt-handoff-host").path
        let folder = URL(fileURLWithPath: CommandLine.arguments[1])
        let text = "Synthetic **context** 中文 ✓\n"

        // Framing
        let pipe = Pipe()
        try! Frames.write(["text": text], to: pipe.fileHandleForWriting)
        check((try? Frames.read(from: pipe.fileHandleForReading))?["text"] as? String == text, "UTF-8 frame round trip")
        try! pipe.fileHandleForWriting.close()
        check(outcome(pipe.fileHandleForReading) == "end", "clean end of stream")
        for bytes in [Data([0, 0, 0, 0]), Data([255, 255, 255, 255]), Data([5, 0, 0, 0, 123]), Data([2, 0, 0, 0, 91, 93])] {
            let bad = Pipe()
            try! bad.fileHandleForWriting.write(contentsOf: bytes)
            try! bad.fileHandleForWriting.close()
            check(outcome(bad.fileHandleForReading) == "error", "malformed, oversize or truncated frame rejected")
        }
        check((try? Frames.write(["text": String(repeating: "x", count: 2048)], to: Pipe().fileHandleForWriting, limit: 1024)) == nil,
              "outgoing frame limit enforced")

        // The relay refuses any caller other than the extension.
        let stranger = Process()
        stranger.executableURL = URL(fileURLWithPath: relay)
        stranger.arguments = ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        try! stranger.run(); stranger.waitUntilExit()
        check(stranger.terminationStatus == 1, "relay rejects another extension origin")

        // App side
        let path = folder.appendingPathComponent("link.sock").path
        let link = ChromeLink(path: path, allowedPeer: relay)
        var states: [[String: Any]?] = []
        link.onState = { states.append($0) }
        check(link.start(), "link listens")
        var info = stat()
        check(stat(path, &info) == 0 && info.st_mode & 0o777 == 0o600, "socket is private to the user")

        // An unrelated local process is dropped before it can speak.
        let impostor = connectLink(path)!
        try? Frames.write(["event": "state", "state": ["status": "ready", "title": "Impostor"]], to: impostor)
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        check(states.isEmpty, "non-relay peer ignored")

        func start(_ executable: String) -> (Process, Pipe, Pipe) {
            let process = Process(), input = Pipe(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = [nativeHostAllowedOrigin]
            process.environment = ["GPT_HANDOFF_SOCKET": path]
            process.standardInput = input
            process.standardOutput = output
            try! process.run()
            return (process, input, output)
        }
        func stop(_ process: Process, _ input: Pipe) -> Data {
            try? input.fileHandleForWriting.close()
            process.waitUntilExit()
            return Data()
        }

        // A relay copied elsewhere has no app beside it, so it must never announce this server.
        let elsewhere = folder.appendingPathComponent("elsewhere")
        try! FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
        try! FileManager.default.copyItem(atPath: relay, toPath: elsewhere.appendingPathComponent("gpt-handoff-host").path)
        let (stray, strayInput, strayOutput) = start(elsewhere.appendingPathComponent("gpt-handoff-host").path)
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        _ = stop(stray, strayInput)
        check(strayOutput.fileHandleForReading.readDataToEndOfFile().isEmpty && states.isEmpty,
              "relay refuses a server that is not the app beside it")

        let (process, input, output) = start(relay)
        check((try? Frames.read(from: output.fileHandleForReading))?["connected"] as? Bool == true, "relay announces the app to the extension")

        try! Frames.write(["event": "state", "state": ["status": "ready", "revision": "r1"]], to: input.fileHandleForWriting)
        pump(until: { (states.last ?? nil)?["revision"] as? String == "r1" }, "extension state reaches the app")

        var reply: [String: Any]?
        link.request("context") { reply = $0 }
        let request = try! Frames.read(from: output.fileHandleForReading)!
        check(request["command"] as? String == "context" && request["id"] is String, "app request reaches the extension")
        try! Frames.write(["id": request["id"]!, "ok": true, "markdown": text], to: input.fileHandleForWriting)
        pump(until: { reply != nil }, "extension reply reaches the app")
        check(reply?["markdown"] as? String == text, "reply is exact")

        // A second Chrome (another profile or channel) is refused instead of displacing the first.
        let (second, secondInput, _) = start(relay)
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        check(states.last.map { $0 != nil } == true, "second relay does not disconnect the first")
        _ = stop(second, secondInput)

        var late: [String: Any]? = ["unset": true]
        link.request("check", timeout: 0.3) { late = $0 }
        _ = try! Frames.read(from: output.fileHandleForReading)
        pump(until: { late == nil }, "unanswered request times out as nil")

        try! input.fileHandleForWriting.close()
        process.waitUntilExit()
        check(process.terminationStatus == 0, "relay exits when Chrome closes the port")
        pump(until: { states.last.map { $0 == nil } ?? false }, "app sees Chrome disconnect")
        print("PASS: \(checks) link checks with the real relay")
        exit(0)
    }
}
