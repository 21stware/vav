import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var client: RemoteClient
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                ForEach(client.sessions) { session in
                    NavigationLink(value: session) {
                        SessionRow(session: session)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            client.archive(conversationId: session.id)
                        } label: {
                            Label("归档", systemImage: "archivebox")
                        }
                    }
                }
            }
            .overlay {
                if client.sessions.isEmpty {
                    ContentUnavailableView(
                        "暂无会话",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text(emptyHint)
                    )
                }
            }
            .navigationTitle(HostLinkStyle.displayName(client))
            .navigationDestination(for: RemoteSession.self) { session in
                SessionDetailView(session: session)
            }
            .toolbarTitleMenu {
                HostSwitcherButtons()
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Circle()
                        .fill(HostLinkStyle.color(client.state))
                        .frame(width: 8, height: 8)
                        .accessibilityLabel(HostLinkStyle.statusLabel(client.state))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        client.createSession()
                    } label: {
                        if client.creating {
                            ProgressView()
                        } else {
                            Image(systemName: "plus")
                        }
                    }
                    .disabled(!canCreate)
                    .accessibilityLabel("新会话")
                }
            }
            .refreshable { client.refreshSessions() }
            .onAppear { openIfNeeded(client.openConversationId) }
            .onChange(of: client.openConversationId) { _, id in
                openIfNeeded(id)
            }
            .onChange(of: client.sessions) { _, _ in
                openIfNeeded(client.openConversationId)
            }
            .onChange(of: client.activeToken) { _, _ in
                path = NavigationPath()
            }
            .alert("无法新建会话", isPresented: Binding(
                get: { client.notice != nil },
                set: { if !$0 { client.notice = nil } }
            )) {
                Button("好", role: .cancel) { client.notice = nil }
            } message: {
                Text(client.notice ?? "")
            }
        }
    }

    private var canCreate: Bool {
        if client.creating { return false }
        if case .connected = client.state { return true }
        return false
    }

    private var emptyHint: String {
        if case .connected = client.state { return "点右上角 + 新建会话，或在 Mac 上开一个。" }
        if case .connecting = client.state { return "正在经公网中继连接电脑…" }
        if case .disconnected(let error) = client.state, let error, !error.isEmpty { return error }
        return "未连接到电脑。离开 Wi‑Fi 后需要中继，点设置里的立即重连。"
    }

    private func openIfNeeded(_ id: String?) {
        guard let id, let session = client.sessions.first(where: { $0.id == id }) else { return }
        path = NavigationPath()
        path.append(session)
        client.clearOpenRequest()
    }
}

struct SessionRow: View {
    @EnvironmentObject private var client: RemoteClient
    let session: RemoteSession

    private var generating: Bool {
        client.isGenerating(session.id) || session.status == "running"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(session.title)
                .font(.body.weight(.medium))
                .lineLimit(1)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(generating ? Color.accentColor : .secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }

    /// Same subtitle ladder as the desktop sidebar: status while running, else `{相对时间} · {目录}`.
    private var subtitle: String? {
        if generating { return "流式中" }
        let age = relativeTime(session.updatedAt)
        let dir = session.temporary || session.dirLabel.isEmpty ? nil : session.dirLabel
        if let age, let dir { return "\(age) · \(dir)" }
        if let age { return age }
        if let dir { return dir }
        return nil
    }
}

private func relativeTime(_ timestamp: Double) -> String? {
    guard timestamp > 0 else { return nil }
    let millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
    let delta = Date().timeIntervalSince1970 * 1000 - millis
    let minute = 60_000.0
    let hour = 60 * minute
    let day = 24 * hour
    if delta < minute { return "刚刚" }
    if delta < hour { return "\(Int(delta / minute)) 分钟前" }
    if delta < day { return "\(Int(delta / hour)) 小时前" }
    if delta < 2 * day { return "昨天" }
    if delta < 7 * day { return "\(Int(delta / day)) 天前" }
    if delta < 14 * day { return "上周" }
    let date = Date(timeIntervalSince1970: millis / 1000)
    return date.formatted(date: .abbreviated, time: .omitted)
}
