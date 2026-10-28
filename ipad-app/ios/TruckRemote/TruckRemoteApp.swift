import SwiftUI

@main
struct TruckRemoteApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
                // Keep the screen on until the page reports whether the game is running (see "awake" / "sleep-ok").
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}
