import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var message: NSTextField!
    var starting = false
    let home = URL(string: "http://127.0.0.1:8876/")!
    var framework: URL { URL(fileURLWithPath: UserDefaults.standard.string(forKey: "FrameworkPath") ?? Bundle.main.object(forInfoDictionaryKey: "ReferenceDeskFrameworkPath") as! String) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1250, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Reference Desk"
        window.minSize = NSSize(width: 780, height: 560)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("ReferenceDeskWindow")
        window.center()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
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
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startServer()
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
        NSApp.windowsMenu = win
        NSApp.mainMenu = bar
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Reference Desk", .applicationVersion: "1.0", .credits: NSAttributedString(string: "Your reference libraries, on this Mac.\nThe local server stays running when you close the app so background work can finish.")]) }
    @objc func showFiles() { NSWorkspace.shared.open(framework.appendingPathComponent("libraries")) }
    @objc func chooseFramework() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.message = "Choose your existing Reference Desk Framework folder."
        if panel.runModal() == .OK, let url = panel.url {
            guard FileManager.default.fileExists(atPath: url.appendingPathComponent("launch_review.py").path) else { showError("Choose the folder containing launch_review.py."); return }
            UserDefaults.standard.set(url.path, forKey: "FrameworkPath"); startServer(reload: true)
        }
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func goHome() { navigateSafely(home) }
    @objc func reload() { startServer(reload: true) }
    @objc func openBrowser() { NSWorkspace.shared.open(web.url ?? home) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); startServer(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func startServer(reload: Bool = false) {
        guard !starting else { return }
        starting = true
        let root = framework
        if web.url == nil { message.isHidden = false; message.stringValue = "Starting Reference Desk…" }
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
                    self.starting = false
                    if task.terminationStatus == 0 {
                        self.message.isHidden = true
                        if self.web.url == nil { self.web.load(URLRequest(url: self.home)) }
                        else if reload { self.withSavedChanges { saved in if saved { self.web.reload() } } }
                    } else { self.showError(diagnostic) }
                }
            } catch { DispatchQueue.main.async { self.starting = false; self.showError(error.localizedDescription) } }
        }
    }
    func showError(_ detail: String) {
        message.isHidden = web.url != nil
        message.stringValue = "Reference Desk could not start. Use View → Reload to retry."
        let alert = NSAlert(); alert.messageText = "Reference Desk could not open"; alert.informativeText = detail
        alert.addButton(withTitle: "OK"); alert.beginSheetModal(for: window)
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
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard web?.url != nil else { return .terminateNow }
        withSavedChanges { saved in sender.reply(toApplicationShouldTerminate: saved) }
        return .terminateLater
    }
    func isLocal(_ url: URL) -> Bool { url.scheme == "http" && url.host == "127.0.0.1" && url.port == 8876 }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if isLocal(url) || url.scheme == "blob" || url.scheme == "data" {
            if action.shouldPerformDownload { decisionHandler(.download) }
            else if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            if ["https", "http", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) { decisionHandler(response.canShowMIMEType ? .allow : .download) }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { showError("Download failed: " + error.localizedDescription) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError(error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = text; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage text: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = text; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        let field = NSTextField(string: defaultText ?? ""); field.frame = NSRect(x: 0, y: 0, width: 320, height: 26); alert.accessoryView = field
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
}
let delegate = AppDelegate()
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
