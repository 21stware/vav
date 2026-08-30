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

/// Compact tunnel status for settings / notifications. Sessions use the nav title.
struct ConnectionBadge: View {
    @EnvironmentObject private var client: RemoteClient
    var compact = false

    var body: some View {
        if client.pairings.count > 1 {
            Menu {
                HostSwitcherButtons()
            } label: {
                badge
            }
            .menuIndicator(.hidden)
        } else {
            badge
        }
    }

    private var badge: some View {
        HStack(spacing: 6) {
            Circle().fill(HostLinkStyle.color(client.state)).frame(width: 8, height: 8)
            if !compact {
                Text(HostLinkStyle.statusLabel(client.state))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityLabel(HostLinkStyle.statusLabel(client.state))
    }
}

struct HostSwitcherButtons: View {
    @EnvironmentObject private var client: RemoteClient

    var body: some View {
        ForEach(client.pairings) { pairing in
            Button {
                client.activate(pairing)
            } label: {
                if client.isActive(pairing) {
                    Label(pairing.displayName, systemImage: "checkmark")
                } else {
                    Text(pairing.displayName)
                }
            }
        }
    }
}

enum HostLinkStyle {
    static func color(_ state: RemoteClient.State) -> Color {
        switch state {
        case .connected: return .green
        case .connecting: return .orange
        default: return .red
        }
    }

    static func statusLabel(_ state: RemoteClient.State) -> String {
        switch state {
        case .connected: return "已连接"
        case .connecting: return "连接中…"
        case .disconnected(let error): return error ?? "未连接"
        case .unpaired: return "未配对"
        }
    }

    static func displayName(_ client: RemoteClient) -> String {
        if let name = client.host?.name, !name.isEmpty { return name }
        return client.pairedHost
    }
}
