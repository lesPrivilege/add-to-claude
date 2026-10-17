import AppKit
import Sparkle

// Updates through Sparkle: a daily check of the appcast in the repository (SUFeedURL in Info.plist), an
// update verified with the EdDSA key there (SUPublicEDKey) and a valid code signature, and, when the user
// allows it, downloaded and installed on quit. The check sends Sparkle's request only: no profile.
//
// A scheduled check never opens a window: the panel's header shows the update instead (`offer`). Updates
// downloaded in the background say so there and offer to relaunch; otherwise clicking it shows Sparkle's
// alert. A check from the menu or Settings is Sparkle's own, window and all.

final class Updates: NSObject, UpdateControls, SPUUpdaterDelegate, SPUStandardUserDriverDelegate {
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: self)
    private var updater: SPUUpdater { controller.updater }
    private var installNow: (() -> Void)?
    /// Sparkle's own window shows this update: the header does not repeat it.
    private var presented = false

    var onOffer: ((UpdateOffer) -> Void)?
    private(set) var offer = UpdateOffer.none {
        didSet { if offer != oldValue { onOffer?(offer) } }
    }

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
    var canCheck: Bool { updater.canCheckForUpdates }

    /// A user-initiated check: Sparkle's window says what it found, so this accessory app comes forward first.
    func checkNow() {
        // Not while an update downloads in the background: the header shows that, and Sparkle would ignore it.
        guard updater.canCheckForUpdates else { return }
        NSApp.activate()
        controller.checkForUpdates(nil)
    }

    /// The header's button: relaunch into a downloaded update, or bring the found one forward in Sparkle's alert.
    func acceptOffer() {
        switch offer {
        case .ready: installNow?()
        case .available: checkNow()
        case .none, .downloading: break
        }
    }

    // MARK: Sparkle's alert, only when asked for

    var supportsGentleScheduledUpdateReminders: Bool { true }
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool { false }

    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        presented = handleShowingUpdate
        if !handleShowingUpdate { offer = .available(update.displayVersionString) }
    }

    func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
        presented = true
        if case .available = offer { offer = .none }
    }

    func standardUserDriverWillFinishUpdateSession() {
        presented = false
        if case .available = offer { offer = .none }
    }

    // MARK: Background downloads

    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        if !presented { offer = .downloading(item.displayVersionString) }
    }

    func updater(_ updater: SPUUpdater, failedToDownloadUpdate item: SUAppcastItem, error: Error) {
        if case .downloading = offer { offer = .none }
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        if case .downloading = offer { offer = .none }
    }

    /// Downloaded in the background: it installs when the app quits, or now from the header. Taking the
    /// install pauses Sparkle's daily checks until then: a newer release is found after the next launch.
    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        installNow = immediateInstallHandler
        offer = .ready(item.displayVersionString)
        return true
    }
}
