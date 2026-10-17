import AppKit
import Sparkle

// Updates through Sparkle: a daily check of the appcast in the repository (SUFeedURL in Info.plist), an
// update verified with the EdDSA key there (SUPublicEDKey) and a valid code signature, and, when the user
// allows it, downloaded and installed on quit. The check sends Sparkle's request only: no profile.

final class Updates: NSObject, UpdateControls, SPUStandardUserDriverDelegate {
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: self)
    private var updater: SPUUpdater { controller.updater }

    func start() { _ = controller }

    var automaticallyChecks: Bool {
        get { updater.automaticallyChecksForUpdates }
        set { updater.automaticallyChecksForUpdates = newValue }
    }

    var automaticallyInstalls: Bool {
        get { updater.automaticallyDownloadsUpdates }
        set { updater.automaticallyDownloadsUpdates = newValue }
    }

    var lastCheck: Date? { updater.lastUpdateCheckDate }

    /// A user-initiated check: Sparkle's window says what it found, so this accessory app comes forward first.
    func checkNow() {
        NSApp.activate()
        controller.checkForUpdates(nil)
    }

    // A menu-bar app is rarely in front: a scheduled update shows behind other apps rather than waiting.
    var supportsGentleScheduledUpdateReminders: Bool { true }
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool { true }
}
