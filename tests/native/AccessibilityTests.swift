import AppKit
import ApplicationServices

@MainActor final class AccessibilityRunner: NSObject, NSApplicationDelegate {
    var input: FileHandle?
    var output: FileHandle?
    private let io = DispatchQueue(label: "handoff.synthetic-composer-pipe")
    var checks = 0
    var finished = false
    var fixture: NSRunningApplication!

    func end(_ code: Int32, _ message: String) {
        guard !finished else { return }
        finished = true
        try? input?.close()
        var finalCode = code
        if let fixture {
            let pid = fixture.processIdentifier
            if !fixture.isTerminated { fixture.terminate() }
            for _ in 0..<100 {
                if kill(pid, 0) != 0 { break }
                Thread.sleep(forTimeInterval: 0.02)
            }
            if kill(pid, 0) == 0 {
                fixture.forceTerminate()
                for _ in 0..<50 {
                    if kill(pid, 0) != 0 { break }
                    Thread.sleep(forTimeInterval: 0.02)
                }
                if kill(pid, 0) == 0 { finalCode = 1; print("FAIL: owned synthetic app did not exit") }
            }
        }
        try? output?.close()
        print(message); fflush(stdout)
        exit(finalCode)
    }

    func check(_ result: Bool, _ label: String) {
        guard result else { end(1, "FAIL: " + label); return }
        checks += 1
    }
    func pause() async { try? await Task.sleep(nanoseconds: 150_000_000) }
    func exact(_ actual: String?, _ expected: String) -> Bool {
        guard let actual else { return false }
        return Array(actual.utf8) == Array(expected.utf8)
    }
    func command(_ name: String, window: String = "A", focus: Bool = false, text: String = "") async -> [String: String] {
        await withCheckedContinuation { continuation in
            let input = self.input!, output = self.output!
            io.async {
                do {
                    try Frames.write(["command": name, "window": window, "focus": focus, "text": text], to: input)
                    guard let result = try Frames.read(from: output),
                          result["ok"] as? Bool == true, let drafts = result["drafts"] as? [String: String] else {
                        DispatchQueue.main.async { self.end(1, "Fixture pipe failed") }; return
                    }
                    continuation.resume(returning: drafts)
                } catch { DispatchQueue.main.async { self.end(1, "Fixture pipe failed") } }
            }
        }
    }
    func select() async -> Composer {
        _ = await command("reset", focus: true)
        _ = fixture.activate()
        for _ in 0..<20 {
            if NSWorkspace.shared.frontmostApplication?.processIdentifier == fixture.processIdentifier { break }
            await pause()
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == fixture.processIdentifier else {
            end(2, "NOT RUN: the synthetic app could not become frontmost. Unlock the Mac and keep its desktop available; no focus check was bypassed."); fatalError()
        }
        await pause()
        let app = AXUIElementCreateApplication(fixture.processIdentifier)
        guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], windows.count == 2,
              let front = axElement(app, kAXFocusedWindowAttribute),
              let choice = WindowChoice(app: fixture, window: front),
              let editor = focusedComposer(choice) else {
            end(1, "Synthetic window/composer is not discoverable through real AX"); fatalError()
        }
        check(windows.allSatisfy { axString($0, kAXTitleAttribute) == choice.title }, "same-title fixture windows")
        return Composer(choice: choice, editor: editor)
    }
    func append(_ selected: Composer, text: String = "Original **Markdown** 中文 ✓\n", valid: @escaping () -> Bool = { true }, source: Bool = true,
                during: (() async -> Void)? = nil) async -> (String, Bool) {
        // The target must not need to be frontmost: put this runner in front first.
        NSApp.activate()
        for _ in 0..<20 where NSWorkspace.shared.frontmostApplication?.processIdentifier == fixture.processIdentifier { await pause() }
        check(NSWorkspace.shared.frontmostApplication?.processIdentifier != fixture.processIdentifier, "target app is in the background before append")
        let mutation = during.map { action in Task { await action() } }
        let result: (String, Bool) = await withCheckedContinuation { continuation in
            appendToComposer(selected, text: text, operationValid: valid, revalidateSource: { reply in
                Task { await mutation?.value; reply(source) }
            }) { message, success in
                continuation.resume(returning: (message, success))
            }
        }
        await mutation?.value
        return result
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard AXIsProcessTrusted() else {
            end(2, "NOT RUN: this test runner lacks Accessibility access; no permission was requested."); return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.arguments = [CommandLine.arguments[2]]
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: CommandLine.arguments[1]), configuration: configuration) { app, error in
            DispatchQueue.main.async {
                guard let app, error == nil else { self.end(1, "Could not launch synthetic app"); return }
                self.fixture = app
                let directory = URL(fileURLWithPath: CommandLine.arguments[2])
                DispatchQueue.global().async {
                    let input = FileHandle(forWritingAtPath: directory.appendingPathComponent("requests").path)
                    let output = FileHandle(forReadingAtPath: directory.appendingPathComponent("responses").path)
                    DispatchQueue.main.async {
                        guard let input, let output else { self.end(1, "Could not open synthetic app pipes"); return }
                        self.input = input; self.output = output
                        Task { @MainActor in await self.run() }
                    }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.end(1, "Accessibility fixture timed out") }
    }

    @MainActor func run() async {
        var selected = await select()
        var result = await append(selected)
        var drafts = await command("snapshot")
        check(result.1, "real AX insertion and exact readback")
        check(NSWorkspace.shared.frontmostApplication?.processIdentifier != fixture.processIdentifier, "append never activates the target app")
        check(exact(drafts["A"], "Synthetic draft A.\n\nOriginal **Markdown** 中文 ✓\n"), "fixture independently confirms preserved draft and exact Unicode Markdown")
        check(drafts["B"] == "Synthetic draft B.", "same-title other window unchanged")

        selected = await select()
        let rich = await command("rich", focus: true)
        check(rich["richA"]?.contains("attachment:") == true && rich["richA"]?.contains("link:") == true, "rich fixture contains real attachment and link")
        result = await append(selected)
        drafts = await command("snapshot")
        check(result.1 && exact(drafts["A"], rich["A"]! + "\n\nOriginal **Markdown** 中文 ✓\n"), "rich draft text is appended exactly")
        check(drafts["richA"] == rich["richA"], "existing attachment, link and bold span survive append")

        selected = await select()
        let racedRich = await command("rich", focus: true)
        _ = await command("selection-race")
        result = await append(selected)
        drafts = await command("snapshot")
        check(drafts["selectionRaceA"] == "true", "selection changes during final AXValue read")
        check(!result.1 && drafts["A"] == racedRich["A"] && drafts["richA"] == racedRich["richA"], "late selected text is never replaced; rich draft unchanged")

        selected = await select()
        result = await append(selected, during: { _ = await self.command("draft", text: "Updated synthetic draft 🧪 e\u{301}.") })
        drafts = await command("snapshot")
        check(result.1 && exact(drafts["A"], "Updated synthetic draft 🧪 e\u{301}.\n\nOriginal **Markdown** 中文 ✓\n"), "latest draft and UTF-16 insertion offset preserve emoji and combining marks")

        selected = await select()
        _ = await command("normalize-insertion")
        result = await append(selected, text: "e\u{301}")
        drafts = await command("snapshot")
        check(exact(drafts["A"], "Synthetic draft A.\n\né"), "fixture normalizes inserted text")
        check(!result.1 && result.0.contains("Check the draft"), "normalization cannot receive an exact insertion receipt")

        selected = await select()
        result = await append(selected, text: String(repeating: "x", count: maximumTextBytes + 1))
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "oversized context rejects without truncation or mutation")

        selected = await select()
        result = await append(selected, during: { _ = await self.command("focus", window: "B", focus: true) })
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A." && drafts["B"] == "Synthetic draft B.", "focus change rejects both writes")

        selected = await select()
        result = await append(selected, during: { _ = await self.command("replace", focus: true) })
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "replaced editor rejects stale handle")

        selected = await select()
        _ = await command("rename", focus: true)
        result = await append(selected)
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "renamed window rejects old selection")

        selected = await select()
        _ = await command("readonly", focus: true)
        result = await append(selected)
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "read-only editor rejects mutation")

        selected = await select()
        result = await append(selected, source: false)
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "source permit denial leaves draft unchanged")

        selected = await select()
        var current = true
        result = await append(selected, valid: { current }, during: { current = false })
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "cancellation before delayed write leaves draft unchanged")

        selected = await select()
        _ = await command("code", focus: true)
        result = await append(selected)
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "code editor semantic rejection")

        selected = await select()
        _ = await command("close")
        result = await append(selected)
        drafts = await command("snapshot")
        check(!result.1 && drafts["A"] == "Synthetic draft A.", "closed window rejects stale selection")
        end(0, "PASS: \(checks) real Accessibility checks against synthetic app windows only.")
    }
}

@main enum TestMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AccessibilityRunner()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
