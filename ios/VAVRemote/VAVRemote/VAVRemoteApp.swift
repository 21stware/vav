import SwiftUI
import UserNotifications

@main
struct VAVRemoteApp: App {
    @StateObject private var client = RemoteClient()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(client)
                .onAppear {
                    UNUserNotificationCenter.current().requestAuthorization(
                        options: [.alert, .sound, .badge]
                    ) { _, _ in }
                    client.connectIfNeeded()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: client.connectIfNeeded()
            case .background: client.suspend()
            default: break
            }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var client: RemoteClient

    var body: some View {
        if client.isPaired {
            TabView(selection: $client.selectedTab) {
                SessionsView()
                    .tabItem { Label("会话", systemImage: "bubble.left.and.bubble.right") }
                    .tag(RemoteTab.sessions)
                NotificationsView()
                    .tabItem { Label("通知", systemImage: "bell") }
                    .tag(RemoteTab.notifications)
                SettingsView()
                    .tabItem { Label("设置", systemImage: "gearshape") }
                    .tag(RemoteTab.settings)
            }
        } else {
            PairingView()
        }
    }
}

/// Small colored dot + label reflecting the tunnel state.
struct ConnectionBadge: View {
    @EnvironmentObject private var client: RemoteClient

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var color: Color {
        switch client.state {
        case .connected: return .green
        case .connecting: return .orange
        default: return .red
        }
    }

    private var label: String {
        switch client.state {
        case .connected(let host): return host
        case .connecting: return "连接中…"
        case .disconnected(let error): return error ?? "未连接"
        case .unpaired: return "未配对"
        }
    }
}
