import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var client: RemoteClient
    @State private var path = NavigationPath()
    @State private var filter: SessionListFilter = .all

    private var visibleSessions: [RemoteSession] {
        let rows = client.sessions
        switch filter {
        case .all: return rows
        case .favorite: return rows.filter(\.favorite)
        }
    }

    private var pinnedSessions: [RemoteSession] { visibleSessions.filter(\.pinned) }
    private var looseSessions: [RemoteSession] { visibleSessions.filter { !$0.pinned } }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !pinnedSessions.isEmpty {
                    Section("置顶") {
                        ForEach(pinnedSessions) { session in
                            sessionLink(session)
                        }
                    }
                }
                if !looseSessions.isEmpty {
                    Section {
                        ForEach(looseSessions) { session in
                            sessionLink(session)
                        }
                    } header: {
                        if !pinnedSessions.isEmpty { Text("会话") }
                    }
                }
            }
            .overlay {
                if visibleSessions.isEmpty {
                    if client.sessionsLoad == .loading || client.state == .connecting {
                        ContentUnavailableView {
                            ProgressView()
                        } description: {
                            Text(client.state == .connecting ? "正在连接电脑…" : "正在同步会话…")
                        }
                    } else {
                        ContentUnavailableView(
                            filter == .favorite ? "没有收藏" : "暂无会话",
                            systemImage: filter == .favorite ? "star" : "bubble.left.and.bubble.right",
                            description: Text(emptyHint)
                        )
                    }
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
                    if client.isSyncing {
                        ProgressView()
                            .controlSize(.small)
                            .accessibilityLabel(HostLinkStyle.statusLabel(client))
                    } else {
                        Circle()
                            .fill(HostLinkStyle.color(client))
                            .frame(width: 8, height: 8)
                            .accessibilityLabel(HostLinkStyle.statusLabel(client))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            filter = .all
                        } label: {
                            filterLabel("全部", selected: filter == .all)
                        }
                        Button {
                            filter = .favorite
                        } label: {
                            filterLabel("收藏", selected: filter == .favorite)
                        }
                    } label: {
                        Image(systemName: filter == .favorite ? "star.fill" : "line.3.horizontal.decrease")
                    }
                    .accessibilityLabel(filter == .favorite ? "筛选：收藏" : "筛选会话")
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
            .refreshable { await client.refreshSessionsAndWait() }
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
        if filter == .favorite, !client.sessions.isEmpty {
            return "右滑会话可以收藏，和电脑侧栏是同一份。"
        }
        if client.sessionsLoad == .loading { return "正在同步会话…" }
        if case .connected = client.state { return "点右上角 + 新建会话，或在 Mac 上开一个。" }
        if case .connecting = client.state { return "正在经公网中继连接电脑…" }
        if case .disconnected(let error) = client.state, let error, !error.isEmpty { return error }
        return "未连接到电脑。离开 Wi‑Fi 后需要中继，点设置里的立即重连。"
    }

    @ViewBuilder
    private func sessionLink(_ session: RemoteSession) -> some View {
        NavigationLink(value: session) {
            SessionRow(session: session)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if client.host?.capabilities.favorite == true {
                Button {
                    client.setFavorite(conversationId: session.id, favorite: !session.favorite)
                } label: {
                    Label(session.favorite ? "取消收藏" : "收藏", systemImage: session.favorite ? "star.slash" : "star")
                }
                .tint(.yellow)
            }
            if client.host?.capabilities.pin == true {
                Button {
                    client.setPinned(conversationId: session.id, pinned: !session.pinned)
                } label: {
                    Label(session.pinned ? "取消置顶" : "置顶", systemImage: session.pinned ? "pin.slash" : "pin")
                }
                .tint(.orange)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                client.archive(conversationId: session.id)
            } label: {
                Label("归档", systemImage: "archivebox")
            }
        }
        .contextMenu {
            sessionMenu(session)
        }
    }

    @ViewBuilder
    private func sessionMenu(_ session: RemoteSession) -> some View {
        if client.host?.capabilities.favorite == true {
            Button {
                client.setFavorite(conversationId: session.id, favorite: !session.favorite)
            } label: {
                Label(session.favorite ? "取消收藏" : "收藏", systemImage: session.favorite ? "star.slash" : "star")
            }
        }
        if client.host?.capabilities.pin == true {
            Button {
                client.setPinned(conversationId: session.id, pinned: !session.pinned)
            } label: {
                Label(session.pinned ? "取消置顶" : "置顶", systemImage: session.pinned ? "pin.slash" : "pin")
            }
        }
        Button(role: .destructive) {
            client.archive(conversationId: session.id)
        } label: {
            Label("归档", systemImage: "archivebox")
        }
    }

    @ViewBuilder
    private func filterLabel(_ title: String, selected: Bool) -> some View {
        if selected {
            Label(title, systemImage: "checkmark")
        } else {
            Text(title)
        }
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
        HStack(alignment: .firstTextBaseline, spacing: 8) {
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
            Spacer(minLength: 8)
            if session.favorite {
                Image(systemName: "star.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .accessibilityLabel("已收藏")
            }
            if session.pinned {
                Image(systemName: "pin.fill")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("已置顶")
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

private enum SessionListFilter {
    case all
    case favorite
}
