import AppKit

final class NativeHostApplication: NSObject, NSApplicationDelegate {
    private var session: NativeHostSession!
    private let backend: NativeComposerBackend
    private let terminated: () -> Void
    init(backend: NativeComposerBackend, terminated: @escaping () -> Void = {}) {
        self.backend = backend; self.terminated = terminated
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        session = NativeHostSession(backend: backend) { packet in
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
    func applicationWillTerminate(_ notification: Notification) { session?.disconnect(); terminated() }
}

