import Foundation

// Stands in for the menu-bar app in the Chrome test: the real ChromeLink, driven over stdio by the
// test as JSON lines. Installed as `gpt-handoff` beside the relay so the relay's peer check passes.
@main enum StandIn {
    static func emit(_ value: [String: Any]) {
        let line = try! JSONSerialization.data(withJSONObject: value) + Data("\n".utf8)
        FileHandle.standardOutput.write(line)
    }

    static func main() {
        signal(SIGPIPE, SIG_IGN)
        let relay = Bundle.main.executableURL!.resolvingSymlinksInPath()
            .deletingLastPathComponent().appendingPathComponent("gpt-handoff-host").path
        let link = ChromeLink(path: CommandLine.arguments[1], allowedPeer: relay)
        link.onState = { state in emit(["state": state ?? NSNull()]) }
        guard link.start() else { emit(["error": "listen"]); exit(1) }
        emit(["listening": true])
        Thread.detachNewThread {
            while let line = readLine() {
                guard let request = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                      let id = request["id"], let command = request["command"] as? String else { continue }
                var values = request
                values.removeValue(forKey: "id"); values.removeValue(forKey: "command")
                DispatchQueue.main.async {
                    link.request(command, values) { reply in emit(["id": id, "reply": reply ?? NSNull()]) }
                }
            }
            exit(0)
        }
        RunLoop.main.run()
    }
}
