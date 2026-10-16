import AppKit
import ApplicationServices

// Read-only Accessibility probe: what does a target app's window say about which conversation it
// shows? For each window of the app it prints the title, AXDocument, every AXWebArea's AXURL and
// AXTitle, and the conversation id Add to Claude would read (native/Composer.swift). It never
// activates, clicks, types or sends. Like the app, it sets AXManualAccessibility on the target so an
// Electron app exposes its web content to Accessibility clients.
@main enum ProbeTargetAX {
    static func main() {
        let bundle = CommandLine.arguments.dropFirst().first ?? "com.anthropic.claudefordesktop"
        guard AXIsProcessTrusted() else {
            print("NOT RUN: this terminal lacks Accessibility access (System Settings → Privacy & Security → Accessibility).")
            exit(2)
        }
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundle)
        guard !apps.isEmpty else { print("No running app with bundle id \(bundle)."); exit(1) }
        for app in apps {
            print("App: \(app.localizedName ?? "?") (\(bundle)) pid \(app.processIdentifier)")
            let element = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetAttributeValue(element, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            Thread.sleep(forTimeInterval: 0.5) // Electron builds its tree after the flag is set.
            let windows = attribute(element, kAXWindowsAttribute) as? [AXUIElement] ?? []
            print("  windows: \(windows.count)")
            for (index, window) in windows.enumerated() {
                print("  [\(index + 1)] title: \(axString(window, kAXTitleAttribute) ?? "(none)")")
                print("      AXDocument: \(axString(window, kAXDocumentAttribute) ?? "(none)")")
                var queue: [(AXUIElement, Int)] = [(window, 0)], visited = 0, areas = 0
                while !queue.isEmpty && visited < 4000 {
                    let (node, depth) = queue.removeFirst()
                    visited += 1
                    if axString(node, kAXRoleAttribute) == "AXWebArea" {
                        areas += 1
                        let value = attribute(node, kAXURLAttribute)
                        let url = (value as? URL)?.absoluteString ?? value as? String
                        print("      AXWebArea \(areas) at depth \(depth): AXURL \(url ?? "(none)") · AXTitle \(axString(node, kAXTitleAttribute) ?? "(none)")")
                    }
                    if depth < 20, let children = attribute(node, kAXChildrenAttribute) as? [AXUIElement] {
                        queue.append(contentsOf: children.map { ($0, depth + 1) })
                    }
                }
                print("      web areas: \(areas) · elements visited: \(visited)")
                print("      conversation id Add to Claude reads: \(conversationIdentity(in: window) ?? "none (falls back to All and the explicit binding)")")
            }
        }
    }
}
