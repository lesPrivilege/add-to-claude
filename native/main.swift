import AppKit
import ApplicationServices

// Utility name; keep menu and bundle labels consistent.
private let displayName = "gpt-handoff"
private let deskURL = URL(string: "http://127.0.0.1:43119/")!
private let healthURL = deskURL.appendingPathComponent("health")
private let maximumTextBytes = 2 * 1024 * 1024
private let accessibilityTimeout: Float = 0.15

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    guard AXUIElementSetMessagingTimeout(element, accessibilityTimeout) == .success else { return nil }
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

private func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    let result = value as! AXUIElement
    guard AXUIElementSetMessagingTimeout(result, accessibilityTimeout) == .success else { return nil }
    return result
}

private func axString(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name) as? String
}

private func same(_ lhs: AXUIElement?, _ rhs: AXUIElement) -> Bool {
    guard let lhs else { return false }
    return CFEqual(lhs, rhs)
}

private func safeLabel(_ text: String, limit: Int = 90) -> String {
    let visible = text.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
    return String(String.UnicodeScalarView(visible)).prefix(limit).description
}

private func isTerminal(_ app: NSRunningApplication) -> Bool {
    let identity = ((app.bundleIdentifier ?? "") + " " + (app.localizedName ?? "")).lowercased()
    return ["terminal", "iterm", "warp", "alacritty", "kitty", "wezterm", "ghostty", "hyper", "tabby", "rio-terminal", "termius"].contains { identity.contains($0) }
}

private final class WindowChoice: NSObject {
    let app: NSRunningApplication
    let launchDate: Date
    let window: AXUIElement
    let title: String
    private let handleCue: String
    var identityOrdinal = 0
    var needsIdentityCue = false

    init?(app: NSRunningApplication, window: AXUIElement) {
        guard let launchDate = app.launchDate else { return nil }
        self.app = app
        self.launchDate = launchDate
        self.window = window
        self.title = axString(window, kAXTitleAttribute) ?? "Untitled window"
        self.handleCue = String(CFHash(window), radix: 16).suffix(6).description
    }

    func displayLabel(limit: Int = 90) -> String {
        let label = safeLabel(title, limit: limit)
        // This identifies a live AX handle, not conversation content or a window title.
        return needsIdentityCue ? "\(label) · window \(handleCue)-\(identityOrdinal)" : label
    }
}

private struct Composer {
    let choice: WindowChoice
    let editor: AXUIElement
}

private final class ConsentGate: NSObject {
    weak var button: NSButton?
    @objc func changed(_ sender: NSButton) { button?.isEnabled = sender.state == .on }
}

private enum Health { case absent, ready(String?), occupied }

// Bound even a hostile response from an unrelated local service to 4 KiB.
private final class HealthProbe: NSObject, URLSessionDataDelegate {
    private var session: URLSession?
    private var buffer = Data()
    private var completed = false
    private let completion: (Health) -> Void

    init(completion: @escaping (Health) -> Void) { self.completion = completion }

    func start() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1
        config.timeoutIntervalForResource = 2
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.connectionProxyDictionary = [:]
        let created = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session = created
        var request = URLRequest(url: healthURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        created.dataTask(with: request).resume()
    }

    func cancel() { session?.invalidateAndCancel(); session = nil }

    private func finish(_ result: Health) {
        guard !completed else { return }
        completed = true
        cancel()
        DispatchQueue.main.async { self.completion(result) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.url == healthURL, response.expectedContentLength <= 4096 else {
            completionHandler(.cancel)
            finish(.occupied)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard buffer.count + data.count <= 4096 else { finish(.occupied); return }
        buffer.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as NSError?, error.domain == NSURLErrorDomain && error.code == NSURLErrorCannotConnectToHost {
            finish(.absent)
        } else if error == nil,
                  let json = try? JSONSerialization.jsonObject(with: buffer) as? [String: Any],
                  json["app"] as? String == "gpt-handoff", json["protocol"] as? Int == 1 {
            finish(.ready(json["nativeInstance"] as? String))
        } else { finish(.occupied) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var menu = NSMenu()
    private var message = "Ready when you are" {
        didSet { statusItem?.button?.toolTip = message }
    }
    private var child: Process?
    private var nativeInstance: String?
    private var composer: Composer?
    private var availableWindows: [WindowChoice] = []
    private var nextWindowIdentity = 1
    private var discoveringWindows = false
    private var busy = false
    private var operation = UUID()
    private var activeProbe: HealthProbe?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "text.badge.plus", accessibilityDescription: displayName)
        statusItem.button?.toolTip = displayName
        menu.delegate = self
        statusItem.menu = menu
        rebuildMenu()
    }

    func applicationWillTerminate(_ notification: Notification) {
        operation = UUID()
        activeProbe?.cancel()
        if let child, child.isRunning { child.terminate() }
    }

    func menuWillOpen(_ menu: NSMenu) { rebuildMenu(); discoverWindows() }

    private func item(_ title: String, _ action: Selector? = nil, key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.target = self
        return result
    }

    private func rebuildMenu() {
        menu.removeAllItems()
        menu.addItem(item(displayName))
        menu.addItem(item(safeLabel(message)))
        menu.addItem(.separator())
        menu.addItem(item("Open ChatGPT in Chrome", #selector(openChatGPT), key: "g"))
        let desk = item(busy ? "Working…" : "Open transfer desk", #selector(openDesk), key: "o")
        desk.isEnabled = !busy
        menu.addItem(desk)
        menu.addItem(.separator())
        let picker = item("Choose composer window…")
        picker.submenu = targetMenu()
        picker.isEnabled = !busy
        menu.addItem(picker)
        if let composer {
            menu.addItem(item("Selected: \(safeLabel(composer.choice.app.localizedName ?? "App", limit: 32)) · \(composer.choice.displayLabel(limit: 48))"))
        }
        let append = item("Append copied text…", #selector(appendClipboard), key: "v")
        append.isEnabled = composer != nil && !busy
        menu.addItem(append)
        if composer != nil { menu.addItem(item("Clear selected composer", #selector(clearComposer))) }
        menu.addItem(.separator())
        if !AXIsProcessTrusted() { menu.addItem(item("Enable composer access…", #selector(enableAccess))) }
        menu.addItem(item("Quit \(displayName)", #selector(quit), key: "q"))
        menu.autoenablesItems = false
        for entry in menu.items where entry.action == nil && entry.submenu == nil { entry.isEnabled = false }
    }

    private func targetMenu() -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        guard AXIsProcessTrusted() else {
            submenu.addItem(item("Enable composer access…", #selector(enableAccess)))
            return submenu
        }
        var grouped: [(app: NSRunningApplication, choices: [WindowChoice])] = []
        for choice in availableWindows {
            if let index = grouped.firstIndex(where: { $0.app.processIdentifier == choice.app.processIdentifier }) {
                grouped[index].choices.append(choice)
            } else { grouped.append((choice.app, [choice])) }
        }
        for group in grouped {
            let appMenu = NSMenu()
            appMenu.autoenablesItems = false
            for choice in group.choices {
                let row = item(choice.displayLabel(), #selector(selectWindow(_:)))
                row.representedObject = choice
                appMenu.addItem(row)
            }
            let appItem = item(safeLabel(group.app.localizedName ?? group.app.bundleIdentifier ?? "App", limit: 48))
            appItem.submenu = appMenu
            submenu.addItem(appItem)
        }
        if submenu.items.isEmpty {
            let row = item(discoveringWindows ? "Finding open windows…" : "Open an app and focus its composer first")
            row.isEnabled = false
            submenu.addItem(row)
        }
        return submenu
    }

    private func discoverWindows() {
        guard AXIsProcessTrusted(), !discoveringWindows else { return }
        discoveringWindows = true
        let apps = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && !$0.isTerminated && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !isTerminal($0)
        }.sorted { ($0.localizedName ?? "").localizedCaseInsensitiveCompare($1.localizedName ?? "") == .orderedAscending }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var found: [WindowChoice] = []
            for app in apps.prefix(80) {
                let axApp = AXUIElementCreateApplication(app.processIdentifier)
                AXUIElementSetMessagingTimeout(axApp, accessibilityTimeout)
                guard let windows = attribute(axApp, kAXWindowsAttribute) as? [AXUIElement] else { continue }
                for window in windows.prefix(30) {
                    AXUIElementSetMessagingTimeout(window, accessibilityTimeout)
                    if let choice = WindowChoice(app: app, window: window) { found.append(choice) }
                }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                let previousByApp = Dictionary(grouping: self.availableWindows) { $0.app.processIdentifier }
                let visibleTitleCounts = Dictionary(grouping: found) {
                    "\($0.app.processIdentifier):\(safeLabel($0.title, limit: 48))"
                }.mapValues { $0.count }
                for choice in found {
                    if let previous = previousByApp[choice.app.processIdentifier]?.first(where: {
                        $0.launchDate == choice.launchDate && CFEqual($0.window, choice.window)
                    }) {
                        choice.identityOrdinal = previous.identityOrdinal
                    } else {
                        choice.identityOrdinal = self.nextWindowIdentity
                        self.nextWindowIdentity += 1
                    }
                    // Also distinguish titles that look identical after the shortest UI truncation.
                    let titleKey = "\(choice.app.processIdentifier):\(safeLabel(choice.title, limit: 48))"
                    choice.needsIdentityCue = (visibleTitleCounts[titleKey] ?? 0) > 1
                }
                self.availableWindows = found
                self.discoveringWindows = false
                self.rebuildMenu()
            }
        }
    }

    @objc private func enableAccess() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if AXIsProcessTrustedWithOptions(options) { message = "Choose a composer window" }
        else { message = "Enable this app in System Settings → Accessibility" }
    }

    @objc private func clearComposer() { operation = UUID(); composer = nil; message = "Selection cleared" }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func openChatGPT() { openInChrome(URL(string: "https://chatgpt.com/")!) }

    private func openInChrome(_ url: URL) {
        guard let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") else {
            notice("Chrome is not installed", "Install or open Google Chrome, then try again.")
            return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: config) { [weak self] _, error in
            guard error != nil else { return }
            DispatchQueue.main.async { self?.notice("Chrome could not open", "Open Chrome and try again.") }
        }
    }

    private func probe(_ completion: @escaping (Health) -> Void) {
        let request = HealthProbe { [weak self] result in
            self?.activeProbe = nil
            completion(result)
        }
        activeProbe = request
        request.start()
    }

    @objc private func openDesk() {
        guard !busy else { return }
        busy = true
        message = "Checking transfer desk…"
        probe { [weak self] health in
            guard let self else { return }
            switch health {
            case .ready(let instance):
                if let expected = self.nativeInstance, instance != expected {
                    self.startFailure("Another service has taken the transfer desk port. Quit it, then try again.")
                } else {
                    self.busy = false
                    self.message = "Transfer desk ready"
                    self.openInChrome(deskURL)
                }
            case .absent: self.launchServer()
            case .occupied: self.startFailure("Port 43119 is occupied or not responding as this app. Close the other local service, then try again.")
            }
        }
    }

    private func launchServer() {
        guard child?.isRunning != true else {
            startFailure("The local server stopped responding. Quit this app and open it again.")
            return
        }
        guard let resource = Bundle.main.resourceURL,
              let config = NSDictionary(contentsOf: resource.appendingPathComponent("Runtime.plist")),
              let nodePath = config["NodeExecutable"] as? String, nodePath.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: nodePath) else {
            startFailure("The configured Node executable is missing. Rebuild the app with the installed Node path.")
            return
        }
        let project = resource.appendingPathComponent("project", isDirectory: true)
        let entry = project.appendingPathComponent("src/server.js")
        guard FileManager.default.fileExists(atPath: entry.path) else {
            startFailure("The bundled server is missing. Rebuild the app.")
            return
        }
        let instance = UUID().uuidString
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [entry.path]
        process.currentDirectoryURL = project
        // Do not inherit NODE_OPTIONS, shell startup variables, or browser credentials.
        process.environment = ["PATH": "/usr/bin:/bin", "NODE_ENV": "production", "HOST": "127.0.0.1", "PORT": "43119", "ADD_IT_NATIVE_INSTANCE": instance]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] exited in
            DispatchQueue.main.async {
                guard let self, self.child === exited else { return }
                self.child = nil
                self.nativeInstance = nil
                self.message = "Transfer desk stopped · open to restart"
            }
        }
        do {
            try process.run()
            child = process
            nativeInstance = instance
            waitForServer(instance, attempts: 20)
        } catch { startFailure("Node could not start. Check the configured Node executable and rebuild the app.") }
    }

    private func waitForServer(_ instance: String, attempts: Int) {
        probe { [weak self] health in
            guard let self else { return }
            if case .ready(let actual) = health, actual == instance, self.child?.isRunning == true {
                self.busy = false
                self.message = "Transfer desk ready"
                self.openInChrome(deskURL)
                return
            }
            guard attempts > 0, self.child?.isRunning == true else {
                if self.child?.isRunning == true { self.child?.terminate() }
                self.startFailure("The bundled server did not become ready. Check Node 24 and that port 43119 is free, then open the transfer desk again.")
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(instance, attempts: attempts - 1) }
        }
    }

    private func startFailure(_ detail: String) { busy = false; message = "Transfer desk needs attention"; notice("Could not open transfer desk", detail) }

    private func validWindow(_ choice: WindowChoice) -> Bool {
        guard !choice.app.isTerminated, choice.app.launchDate == choice.launchDate, !isTerminal(choice.app) else { return false }
        let app = AXUIElementCreateApplication(choice.app.processIdentifier)
        guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], windows.contains(where: { CFEqual($0, choice.window) }) else { return false }
        return (axString(choice.window, kAXTitleAttribute) ?? "Untitled window") == choice.title
    }

    private func focus(_ choice: WindowChoice) -> Bool {
        guard validWindow(choice) else { return false }
        guard AXUIElementPerformAction(choice.window, kAXRaiseAction as CFString) == .success else { return false }
        return choice.app.activate(options: [.activateIgnoringOtherApps])
    }

    private func focusedComposer(_ choice: WindowChoice) -> AXUIElement? {
        guard AXIsProcessTrusted(), validWindow(choice), NSWorkspace.shared.frontmostApplication?.processIdentifier == choice.app.processIdentifier else { return nil }
        let app = AXUIElementCreateApplication(choice.app.processIdentifier)
        guard same(axElement(app, kAXFocusedWindowAttribute), choice.window),
              let field = axElement(app, kAXFocusedUIElementAttribute),
              same(axElement(field, kAXWindowAttribute), choice.window),
              axString(field, kAXRoleAttribute) == kAXTextAreaRole else { return nil }
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(field, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else { return nil }
        let semantics = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXIdentifier"].compactMap { axString(field, $0) }.joined(separator: " ").lowercased()
        // Fail closed for accessible names that explicitly identify a shell or code pane.
        guard !["terminal", "shell", "source editor", "code editor", "source code", "editor contents", "monaco"].contains(where: { semantics.contains($0) }) else { return nil }
        return field
    }

    @objc private func selectWindow(_ sender: NSMenuItem) {
        guard !busy, let choice = sender.representedObject as? WindowChoice else { return }
        composer = nil
        let id = UUID()
        operation = id
        guard focus(choice) else { notice("Window is no longer available", "Focus the intended composer, then choose its window again."); return }
        busy = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.operation == id else { return }
            self.busy = false
            guard let field = self.focusedComposer(choice) else {
                self.message = "Focus a writable composer and select again"
                self.notice("Composer is not ready", "Focus a writable text area in this window, then choose it again. Terminal hosts and code panes are not supported. If the app does not expose a writable composer, paste manually.")
                return
            }
            self.composer = Composer(choice: choice, editor: field)
            self.message = "Composer selected · copy text in the transfer desk"
        }
    }

    @objc private func appendClipboard() {
        guard !busy, let selected = composer else { return }
        let pasteboard = NSPasteboard.general
        let clipboardVersion = pasteboard.changeCount
        guard let text = pasteboard.string(forType: .string), !text.isEmpty, text.utf8.count <= maximumTextBytes else {
            notice("Copy text first", "Copy the conversation from the transfer desk. Native append accepts plain text up to 2 MiB; attach downloaded files manually.")
            return
        }
        guard validWindow(selected.choice) else { composer = nil; notice("Target changed", "Choose the intended composer window again."); return }
        let alert = NSAlert()
        alert.messageText = "Append to \(safeLabel(selected.choice.app.localizedName ?? "this app", limit: 48))?"
        alert.informativeText = "\(selected.choice.displayLabel(limit: 140))\n\nAppend \(text.count.formatted()) characters to the selected text area. Existing text stays above it. Files must be attached separately."
        let append = alert.addButton(withTitle: "Append text")
        append.isEnabled = false
        alert.addButton(withTitle: "Cancel").keyEquivalent = "\u{1b}"
        let gate = ConsentGate()
        gate.button = append
        let consent = NSButton(checkboxWithTitle: "I selected the intended composer", target: gate, action: #selector(ConsentGate.changed(_:)))
        consent.setAccessibilityHelp("Confirm this text area is the intended composer, not a shell or a code editor.")
        consent.frame = NSRect(x: 0, y: 0, width: 310, height: 28)
        alert.accessoryView = consent
        NSApp.activate(ignoringOtherApps: true)
        let result = withExtendedLifetime(gate) { alert.runModal() }
        guard result == .alertFirstButtonReturn, consent.state == .on else { message = "Append cancelled · nothing changed"; return }
        guard pasteboard.changeCount == clipboardVersion else { notice("Clipboard changed", "Copy the intended text and try again."); return }
        guard focus(selected.choice) else { composer = nil; notice("Target changed", "Choose the intended composer window again."); return }
        busy = true
        let id = UUID()
        operation = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.operation == id else { return }
            defer { self.busy = false }
            guard pasteboard.changeCount == clipboardVersion,
                  let current = self.focusedComposer(selected.choice), CFEqual(current, selected.editor),
                  let old = axString(current, kAXValueAttribute), old.utf8.count + text.utf8.count + 2 <= maximumTextBytes else {
                self.composer = nil
                self.notice("Target is no longer ready", "Nothing was appended. Focus the intended composer, choose its window again, and retry.")
                return
            }
            let combined = old.isEmpty ? text : old + "\n\n" + text
            // No synthetic keys, Return, paste shortcut, shell, or executable attachments.
            let result = AXUIElementSetAttributeValue(current, kAXValueAttribute as CFString, combined as CFString)
            guard result == .success, axString(current, kAXValueAttribute) == combined else {
                self.composer = nil
                self.message = "Append could not be verified"
                self.notice("Inspect the composer before retrying", "The app did not confirm the exact text. Some text may have changed. Review the draft before copying or trying again.")
                return
            }
            self.message = "Text appended and verified · review before sending"
            self.composer = nil
        }
    }

    private func notice(_ title: String, _ detail: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
