import AppKit
import ApplicationServices

final class AccessibilityBackend: NativeComposerBackend {
    private let registry = ComposerRegistry()
    var trusted: Bool { AXIsProcessTrusted() }
    func requestAccess() { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
    func discover() -> [[String: String]] { registry.discover() }
    func select(_ id: String) -> String? { registry.select(id) }
    func clear() { registry.clear() }
    func append(_ text: String, valid: @escaping () -> Bool, revalidate: @escaping (@escaping (Bool) -> Void) -> Void,
                completion: @escaping (String, Bool) -> Void) {
        guard let selected = registry.selected else { completion("Choose a composer first.", false); return }
        appendToComposer(selected, text: text, operationValid: valid, revalidateSource: revalidate, completion: completion)
    }
}

final class HostApplication: NSObject, NSApplicationDelegate {
    private var session: NativeHostSession!
    func applicationDidFinishLaunching(_ notification: Notification) {
        session = NativeHostSession(backend: AccessibilityBackend()) { packet in
            do { try NativeFrames.write(packet, to: .standardOutput) }
            catch { NSApp.terminate(nil) }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                while let packet = try NativeFrames.read(from: .standardInput) {
                    DispatchQueue.main.sync { self.session.receive(packet) }
                }
            } catch { /* Fixed termination, never echo untrusted input or the draft. */ }
            DispatchQueue.main.async { self.session.disconnect(); NSApp.terminate(nil) }
        }
    }
    func applicationWillTerminate(_ notification: Notification) { session?.disconnect() }
}

@main enum NativeHostMain {
    static func main() {
        guard CommandLine.arguments.count >= 2, CommandLine.arguments[1] == nativeHostAllowedOrigin else { exit(1) }
        let app = NSApplication.shared
        let delegate = HostApplication()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
