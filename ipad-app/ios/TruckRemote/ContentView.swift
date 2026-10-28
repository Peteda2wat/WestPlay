import SwiftUI
import UIKit
import WebKit

let backgroundColor = Color(red: 0.055, green: 0.067, blue: 0.086)

/// Turns what the user typed ("192.168.1.20", "192.168.1.20:8765", "http://...") into the PC's URL.
func pcURL(from text: String) -> URL? {
    var address = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if address.isEmpty { return nil }
    if !address.lowercased().hasPrefix("http://") && !address.lowercased().hasPrefix("https://") {
        address = "http://" + address
    }
    guard var components = URLComponents(string: address), let host = components.host, !host.isEmpty else { return nil }
    if components.port == nil { components.port = 8765 }
    components.path = "/"
    return components.url
}

struct ContentView: View {
    @AppStorage("pcAddress") private var pcAddress = ""
    @State private var editing = false

    var body: some View {
        if editing || pcURL(from: pcAddress) == nil {
            SetupView(address: pcAddress) { newAddress in
                pcAddress = newAddress
                editing = false
            }
        } else if let url = pcURL(from: pcAddress) {
            RemoteView(url: url) { editing = true }
                .id(url)
        }
    }
}

/// First-run screen: asks for the address shown on the iPad page of ATS GPS on the PC.
struct SetupView: View {
    @State var address: String
    let onSave: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("ATS GPS").font(.largeTitle.bold())
            Text("Start ATS GPS on your PC and type the PC address its iPad page shows, for example 192.168.1.20:8765. The iPad must be on the same Wi-Fi as the PC.")
                .foregroundStyle(.secondary)
            TextField("192.168.1.20:8765", text: $address)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.title2.monospaced())
                .padding(14)
                .background(Color(white: 0.15), in: RoundedRectangle(cornerRadius: 12))
                .onSubmit(save)
            Button(action: save) {
                Text("Connect").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(pcURL(from: address) == nil)
        }
        .padding(32)
        .frame(maxWidth: 540)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundColor.ignoresSafeArea())
    }

    private func save() {
        if pcURL(from: address) != nil {
            onSave(address.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}

/// Shows the button box / GPS page served by the PC, full screen.
struct RemoteView: View {
    let url: URL
    let onSettings: () -> Void
    @StateObject private var model = WebModel()

    var body: some View {
        ZStack {
            backgroundColor.ignoresSafeArea()
            WebView(webView: model.webView).ignoresSafeArea()
            if let error = model.errorMessage {
                VStack(spacing: 16) {
                    Text("Can't reach your PC").font(.title2.bold())
                    Text("Make sure ATS GPS is running and the iPad is on the same Wi-Fi as the PC.")
                        .multilineTextAlignment(.center)
                    Text(error).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    HStack(spacing: 12) {
                        Button("Try again") { model.load(url) }
                            .buttonStyle(.borderedProminent)
                        Button("Change PC address", action: onSettings)
                            .buttonStyle(.bordered)
                    }
                }
                .padding(28)
                .frame(maxWidth: 460)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            }
        }
        .onAppear {
            model.onSettings = onSettings
            model.load(url)
        }
        .onDisappear { model.tearDown() }
    }
}

struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Owns the web view and handles messages from the page ("tap" for haptics, "settings" for the PC address screen).
@MainActor
final class WebModel: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    @Published var errorMessage: String?
    var onSettings: () -> Void = {}
    let webView: WKWebView
    private let haptics = UIImpactFeedbackGenerator(style: .medium)
    private static let handlerName = "truckRemote"

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()   // remembers the connect code between launches
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: Self.handlerName)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(backgroundColor)
        webView.scrollView.backgroundColor = UIColor(backgroundColor)
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        haptics.prepare()
    }

    private var lastURL: URL?

    func load(_ url: URL) {
        errorMessage = nil
        lastURL = url
        webView.isOpaque = false   // see-through only until the page has drawn, so there's no white flash
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
    }

    /// Once the page is up it covers everything: draw the web view solid so iOS doesn't blend it every frame.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.isOpaque = true
    }

    /// iOS can stop the page's process when memory runs low (the routing data is big): load it again instead of
    /// leaving a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let url = lastURL { load(url) }
    }

    /// The content controller holds on to its handlers, so release this one when the screen goes away.
    func tearDown() {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        errorMessage = error.localizedDescription
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        errorMessage = error.localizedDescription
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String else { return }
        switch text {
        case "tap":
            haptics.impactOccurred()
            haptics.prepare()
        case "settings":
            onSettings()
        // The page says whether the game is running: keep the screen on while it is, otherwise let the iPad's
        // normal Auto-Lock dim and lock it to save battery.
        case "awake":
            UIApplication.shared.isIdleTimerDisabled = true
        case "sleep-ok":
            UIApplication.shared.isIdleTimerDisabled = false
        default:
            break
        }
    }
}
