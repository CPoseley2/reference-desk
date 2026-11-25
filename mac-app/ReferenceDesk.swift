import Cocoa
import WebKit

// The app owns one server; every window owns its own page, dialogs and save lifecycle.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var desks: [DeskWindowController] = []
    var starting = false
    var startCompletions: [(String?) -> Void] = []
    let home = URL(string: "http://127.0.0.1:8876/")!
    var framework: URL { URL(fileURLWithPath: UserDefaults.standard.string(forKey: "FrameworkPath") ?? Bundle.main.object(forInfoDictionaryKey: "ReferenceDeskFrameworkPath") as! String) }
    var activeDesk: DeskWindowController? {
        desks.first { $0.window === NSApp.keyWindow } ?? desks.first { $0.window === NSApp.mainWindow } ?? desks.last
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        buildMenus()
        newWindow()
    }
    @discardableResult func makeWindow(configuration: WKWebViewConfiguration? = nil, loadHome: Bool = true) -> DeskWindowController {
        let desk = DeskWindowController(appDelegate: self, configuration: configuration)
        desks.append(desk)
        desk.showWindow(nil)
        desk.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if loadHome { desk.connect() }
        return desk
    }
    func item(_ title: String, _ action: Selector?, _ key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        if action != nil { i.target = self }
        return i
    }
    func buildMenus() {
        let bar = NSMenu()
        let app = NSMenu(); let appItem = NSMenuItem(); appItem.submenu = app; bar.addItem(appItem)
        app.addItem(item("About Reference Desk", #selector(about)))
        app.addItem(.separator())
        app.addItem(item("Show Library Files", #selector(showFiles)))
        app.addItem(item("Choose Framework Folder…", #selector(chooseFramework)))
        app.addItem(.separator())
        app.addItem(item("Hide Reference Desk", #selector(NSApplication.hide(_:)), "h")); app.items.last?.target = NSApp
        app.addItem(item("Quit Reference Desk", #selector(NSApplication.terminate(_:)), "q")); app.items.last?.target = NSApp
        let file = NSMenu(title: "File"); let fileItem = NSMenuItem(); fileItem.submenu = file; bar.addItem(fileItem)
        file.addItem(item("New Window", #selector(newWindow), "n"))
        file.addItem(.separator())
        file.addItem(NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        let edit = NSMenu(title: "Edit"); let editItem = NSMenuItem(); editItem.submenu = edit; bar.addItem(editItem)
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: NSSelectorFromString(selector), keyEquivalent: key))
        }
        let view = NSMenu(title: "View"); let viewItem = NSMenuItem(); viewItem.submenu = view; bar.addItem(viewItem)
        view.addItem(item("All Libraries", #selector(goHome), "1"))
        view.addItem(item("Reload", #selector(reload), "r"))
        view.addItem(item("Open in Browser", #selector(openBrowser)))
        let win = NSMenu(title: "Window"); let winItem = NSMenuItem(); winItem.submenu = win; bar.addItem(winItem)
        win.addItem(item("Show Reference Desk", #selector(showWindow), "0"))
        let minimize = NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"); win.addItem(minimize)
        win.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))
        NSApp.windowsMenu = win
        NSApp.mainMenu = bar
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Reference Desk", .applicationVersion: "1.1", .credits: NSAttributedString(string: "Your reference libraries, on this Mac.\nOpen separate windows for separate libraries. The shared local server stays running when you close the app.")]) }
    @objc func newWindow() { makeWindow() }
    @objc func showFiles() { NSWorkspace.shared.open(framework.appendingPathComponent("libraries")) }
    @objc func chooseFramework() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.message = "Choose your existing Reference Desk Framework folder."
        if panel.runModal() == .OK, let url = panel.url {
            guard FileManager.default.fileExists(atPath: url.appendingPathComponent("launch_review.py").path) else { activeDesk?.showError("Choose the folder containing launch_review.py."); return }
            UserDefaults.standard.set(url.path, forKey: "FrameworkPath")
            if let desk = activeDesk { desk.connect(reload: true) } else { newWindow() }
        }
    }
    @objc func showWindow() {
        guard let desk = activeDesk else { newWindow(); return }
        if desk.window?.isMiniaturized == true { desk.window?.deminiaturize(nil) }
        desk.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func goHome() { if let desk = activeDesk { desk.navigateSafely(home) } else { newWindow() } }
    @objc func reload() { if let desk = activeDesk { desk.connect(reload: true) } else { newWindow() } }
    @objc func openBrowser() { NSWorkspace.shared.open(activeDesk?.web.url ?? home) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if desks.isEmpty { newWindow() } else { showWindow(); activeDesk?.connect() }
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let openDesks = desks
        guard !openDesks.isEmpty else { return .terminateNow }
        // Confirm every window's saves, not just the window that has keyboard focus.
        func saveNext(_ index: Int) {
            guard index < openDesks.count else { sender.reply(toApplicationShouldTerminate: true); return }
            openDesks[index].withSavedChanges { saved in
                if saved { saveNext(index + 1) }
                else { openDesks[index].window?.makeKeyAndOrderFront(nil); sender.reply(toApplicationShouldTerminate: false) }
            }
        }
        DispatchQueue.main.async { saveNext(0) }
        return .terminateLater
    }
    func startServer(completion: @escaping (String?) -> Void) {
        startCompletions.append(completion)
        guard !starting else { return }
        starting = true
        let root = framework
        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process(); let output = Pipe()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            task.arguments = ["-B", root.appendingPathComponent("launch_review.py").path, "--no-open"]
            task.currentDirectoryURL = root
            task.standardOutput = output; task.standardError = output
            do {
                try task.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                task.waitUntilExit()
                let diagnostic = String(data: data, encoding: .utf8) ?? "Unable to start the library service."
                DispatchQueue.main.async {
                    self.finishStarting(error: task.terminationStatus == 0 ? nil : diagnostic)
                }
            } catch { DispatchQueue.main.async { self.finishStarting(error: error.localizedDescription) } }
        }
    }
    func finishStarting(error: String?) {
        starting = false
        let completions = startCompletions
        startCompletions.removeAll()
        for completion in completions { completion(error) }
    }
}

final class DeskWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
    unowned let appDelegate: AppDelegate
    var web: WKWebView!
    var message: NSTextField!
    var closingWindow = false
    var checkingClose = false
    var titleObservation: NSKeyValueObservation?
    init(appDelegate: AppDelegate, configuration: WKWebViewConfiguration? = nil) {
        self.appDelegate = appDelegate
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1250, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init(window: window)
        window.title = "Reference Desk"
        window.minSize = NSSize(width: 780, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.tabbingMode = .disallowed
        if appDelegate.desks.isEmpty { window.setFrameAutosaveName("ReferenceDeskWindow") }
        if let previous = appDelegate.activeDesk?.window {
            window.cascadeTopLeft(from: NSPoint(x: previous.frame.minX + 24, y: previous.frame.maxY - 24))
        } else { window.center() }
        let config = configuration ?? WKWebViewConfiguration()
        if configuration == nil { config.websiteDataStore = .default() }
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        window.contentView!.addSubview(web)
        message = NSTextField(labelWithString: "Starting Reference Desk…")
        message.font = .systemFont(ofSize: 20, weight: .medium)
        message.alignment = .center
        message.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(message)
        NSLayoutConstraint.activate([message.centerXAnchor.constraint(equalTo: window.contentView!.centerXAnchor), message.centerYAnchor.constraint(equalTo: window.contentView!.centerYAnchor)])
        titleObservation = web.observe(\.title, options: [.new]) { [weak self] web, _ in
            self?.window?.title = web.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Reference Desk"
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func connect(reload: Bool = false) {
        if web.url == nil { message.isHidden = false; message.stringValue = "Starting Reference Desk…" }
        appDelegate.startServer { [weak self] error in
            guard let self = self, self.appDelegate.desks.contains(where: { $0 === self }) else { return }
            if let error = error { self.showError(error); return }
            self.message.isHidden = true
            if self.web.url == nil { self.web.load(URLRequest(url: self.appDelegate.home)) }
            else if reload { self.withSavedChanges { saved in if saved { self.web.reload() } } }
        }
    }
    func windowWillClose(_ notification: Notification) {
        titleObservation = nil
        web.navigationDelegate = nil
        web.uiDelegate = nil
        web.stopLoading()
        appDelegate.desks.removeAll { $0 === self }
    }
    func showError(_ detail: String) {
        message.isHidden = web.url != nil
        message.stringValue = "Reference Desk could not start. Use View → Reload to retry."
        let alert = NSAlert(); alert.messageText = "Reference Desk could not open"; alert.informativeText = detail
        alert.addButton(withTitle: "OK"); alert.beginSheetModal(for: window!)
    }
    func withSavedChanges(_ completion: @escaping (Bool) -> Void) {
        guard web.url != nil else { completion(true); return }
        web.callAsyncJavaScript("const a=window.DESKAutosave;if(!a)return true;await a.flush();const s=a.state();return !s.dirty&&!s.inflight&&!s.conflicted;", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                let saved = value as? Bool ?? false
                if !saved { self.showError("Your latest changes are still saving or need a conflict resolved. Please finish saving before leaving this page.") }
                completion(saved)
            case .failure:
                self.showError("Could not confirm that your latest changes are saved. Please check the library's save status before leaving.")
                completion(false)
            }
        }
    }
    func navigateSafely(_ url: URL) { withSavedChanges { saved in if saved { self.web.load(URLRequest(url: url)) } } }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closingWindow { return true }
        guard !checkingClose else { return false }
        checkingClose = true
        withSavedChanges { saved in
            self.checkingClose = false
            if saved { self.closingWindow = true; sender.close(); self.closingWindow = false }
        }
        return false
    }
    func isLocal(_ url: URL) -> Bool { url.scheme == "http" && url.host == "127.0.0.1" && url.port == 8876 }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let storyboardFrame = action.targetFrame?.isMainFrame == false
            && webView.url?.path.hasSuffix("/storyboard.html") == true
            && url.scheme == "http" && url.host == "127.0.0.1" && url.port == 8899
        if storyboardFrame || isLocal(url) || url.scheme == "blob" || url.scheme == "data" {
            if action.shouldPerformDownload { decisionHandler(.download) }
            else { decisionHandler(.allow) }
        } else {
            if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard action.targetFrame == nil, let url = action.request.url,
              isLocal(url) || url.scheme == "blob" || url.scheme == "data" else { return nil }
        let desk = appDelegate.makeWindow(configuration: configuration, loadHome: false)
        desk.message.isHidden = true
        return desk.web
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) { decisionHandler(response.canShowMIMEType ? .allow : .download) }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
        panel.beginSheetModal(for: window!) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { showError("Download failed: " + error.localizedDescription) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError(error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true
        panel.beginSheetModal(for: window!) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = text; alert.beginSheetModal(for: window!) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = text; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: defaultText ?? ""); field.frame = NSRect(x: 0, y: 0, width: 320, height: 26); alert.accessoryView = field
        alert.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
}
let delegate = AppDelegate()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
