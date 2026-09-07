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
                    DiagLog.start()
                    UNUserNotificationCenter.current().requestAuthorization(
                        options: [.alert, .sound, .badge]
                    ) { _, _ in }
                    client.connectIfNeeded()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                DiagLog.line("scene active")
                client.connectIfNeeded()
            case .background:
                DiagLog.line("scene background — socket will drop")
                client.suspend()
            case .inactive:
                DiagLog.line("scene inactive")
            default:
                break
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
            if client.isSyncing {
                ProgressView().controlSize(.mini)
            } else {
                Circle().fill(HostLinkStyle.color(client)).frame(width: 8, height: 8)
            }
            if !compact {
                Text(HostLinkStyle.statusLabel(client))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityLabel(HostLinkStyle.statusLabel(client))
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
    static func color(_ client: RemoteClient) -> Color {
        switch client.state {
        case .connected: return client.isSyncing ? .orange : .green
        case .connecting: return .orange
        default: return .red
        }
    }

    static func statusLabel(_ client: RemoteClient) -> String {
        switch client.state {
        case .connected:
            if client.sessionsLoad == .loading { return "同步会话…" }
            if client.threadLoad.values.contains(.loading) { return "同步对话…" }
            return "已连接"
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
