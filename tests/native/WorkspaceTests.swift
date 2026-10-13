import AppKit
import WebKit

final class WorkspaceRunner: NSObject, NSApplicationDelegate {
    var workspace: WorkspaceController!
    var finished = false
    var checks = 0
    var addCalls = 0
    var expectedTitle: String?
    var coreURL: URL { URL(string: CommandLine.arguments[1])! }
    var delayedValidity: (() -> Bool)?
    var delayedCompletion: ((String, Bool) -> Void)?
    func end(_ success: Bool, _ message: String) {
        guard !finished else { return }
        finished = true
        print(message); fflush(stdout); exit(success ? 0 : 1)
    }
    func check(_ condition: Bool, _ message: String) {
        if condition { checks += 1 } else { end(false, "FAIL: " + message) }
    }
    func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap { descendants($0) } }
    func button(_ id: String) -> NSButton {
        descendants(workspace.window!.contentView!).first { $0.identifier?.rawValue == "handoff." + id } as! NSButton
    }
    var status: String {
        (descendants(workspace.window!.contentView!).first { $0.identifier?.rawValue == "handoff.status" } as! NSTextField).stringValue
    }
    func wait(_ label: String, attempts: Int = 100, until condition: @escaping () -> Bool, then action: @escaping () -> Void) {
        guard !finished else { return }
        if condition() { action(); return }
        guard attempts > 0 else { end(false, "Timeout: \(label) · \(status)"); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.wait(label, attempts: attempts - 1, until: condition, then: action) }
    }
    func load(_ id: String, mode: String = "complete", then action: @escaping () -> Void) {
        workspace.source.callAsyncJavaScript("await window.workspaceFixture(id, mode); return true", arguments: ["id": id, "mode": mode], in: nil, in: .page) { result in
            if case .failure(let error) = result { self.end(false, "Fixture source failed: \(error)"); return }
            self.wait("source preparation", until: { self.button("preview").isEnabled }, then: action)
        }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let script = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
            let fixture = try String(contentsOfFile: CommandLine.arguments[3], encoding: .utf8)
            workspace = WorkspaceController(coreURL: URL(string: CommandLine.arguments[1])!, observerScript: fixture + "\n" + script,
                websiteDataStore: .nonPersistent(), loadSource: { view in
                    view.loadHTMLString("<!doctype html><textarea>Synthetic unsent draft.</textarea>", baseURL: URL(string: "https://chatgpt.com/c/workspace-synthetic")!)
                })
            workspace.addText = { text, valid, completion in
                self.addCalls += 1
                self.check(text.contains("**Original answer** ✓"), "exact prepared text")
                if let expected = self.expectedTitle { self.check(text.contains(expected), "only latest compiled source is delivered") }
                self.check(valid(), "source validity at Add")
                self.delayedValidity = valid; self.delayedCompletion = completion
            }
            check(!button("preview").isEnabled && !button("add").isEnabled && !button("save").isEnabled, "initial controls disabled")
            wait("synthetic source load", until: { !self.workspace.source.isLoading && self.workspace.source.url?.host == "chatgpt.com" }) {
                self.load("workspace-synthetic") { self.prepared() }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { self.end(false, "Workspace fixture timed out") }
        } catch { end(false, "Setup failed: \(error)") }
    }
    func prepared() {
        check(button("preview").isEnabled && button("save").isEnabled, "Preview and Save without target")
        check(!button("add").isEnabled && addCalls == 0, "capture never invokes Add")
        workspace.setTarget(name: "Synthetic Agent")
        check(button("add").isEnabled && button("add").title == "Add to Synthetic Agent", "selected target enables Add")
        button("add").performClick(nil)
        check(addCalls == 1 && !button("add").isEnabled, "single Add intent; no duplicate while pending")
        workspace.source.evaluateJavaScript("history.pushState({}, '', '/c/other-synthetic')") { _, error in
            if let error { self.end(false, "Navigation fixture failed: \(error)"); return }
            self.wait("navigation invalidation", until: { !self.button("preview").isEnabled }) {
                self.check(self.delayedValidity?() == false, "delayed insertion rejects changed source")
                self.check(!self.button("save").isEnabled, "old source cannot be exported")
                self.delayedCompletion?("Synthetic source changed; nothing inserted", false)
                self.load("other-synthetic", mode: "partial") { self.partial() }
            }
        }
    }
    func partial() {
        check(button("preview").isEnabled && button("save").isEnabled && !button("add").isEnabled, "partial remains previewable/exportable but cannot Add")
        check(status.contains("need attention"), "partial status is visible")
        load("long-synthetic", mode: "long") {
            self.check(!self.button("add").isEnabled && self.button("save").isEnabled, "long text offers file path without truncating")
            self.check(self.status.contains("needs a file"), "long context explanation")
            self.load("final-synthetic") {
                self.check(self.button("add").isEnabled, "source recovery re-enables valid action")
                self.button("add").performClick(nil)
                self.delayedCompletion?("Synthetic insertion complete", true)
                self.check(!self.button("add").isEnabled && self.button("add").title == "Add to Agent", "successful callback clears target selection")
                self.check(self.addCalls == 2, "no automatic send or implicit retry")
                self.compilerRecovery()
            }
        }
    }
    func compilerRecovery() {
        workspace.source.evaluateJavaScript("window.fixtureRequests") { count, error in
            guard error == nil, let before = count as? Int else { self.end(false, "Cannot inspect fixture count"); return }
            self.workspace.compilerDidStop()
            self.check(!self.button("preview").isEnabled && !self.button("add").isEnabled, "compiler-stop notification invalidates prepared controls")
            self.workspace.connectCore(self.coreURL)
            self.wait("compiler recovery", until: { self.button("preview").isEnabled }) {
                self.workspace.source.evaluateJavaScript("window.fixtureRequests") { count, _ in
                    self.check(count as? Int == before, "compiler recovery does not reload or refetch source")
                    self.staleCompilation()
                }
            }
        }
    }
    func staleCompilation() {
        workspace.source.callAsyncJavaScript("await window.workspaceFixture('slow-synthetic'); await new Promise(r => setTimeout(r, 60)); await window.workspaceFixture('fast-synthetic'); return true", arguments: [:], in: nil, in: .page) { result in
            if case .failure(let error) = result { self.end(false, "Compilation race fixture failed: \(error)"); return }
            self.wait("newer compilation", until: { self.button("preview").isEnabled }) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    self.expectedTitle = "# Synthetic fast-synthetic"
                    self.workspace.setTarget(name: "Synthetic Agent")
                    self.button("add").performClick(nil)
                    self.check(self.addCalls == 3, "stale completion cannot replace or automatically deliver context")
                    self.delayedCompletion?("Synthetic completed", true)
                    self.end(true, "PASS native Workspace: \(self.checks) checks through actual WebKit source/compiler and AppKit controls; target callback and compiler-stop event synthetic")
                }
            }
        }
    }

}
@main enum Main {
    static func main() {
        let app = NSApplication.shared
        let runner = WorkspaceRunner()
        app.delegate = runner
        app.setActivationPolicy(.prohibited)
        app.run()
    }
}
