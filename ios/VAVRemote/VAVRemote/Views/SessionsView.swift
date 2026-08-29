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
            .navigationTitle("会话")
            .navigationDestination(for: RemoteSession.self) { session in
                SessionDetailView(session: session)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { ConnectionBadge() }
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
        HStack(spacing: 10) {
            Circle().fill(statusColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title).lineLimit(1)
                if generating {
                    Text("Generating…")
                        .font(.system(size: 13))
                        .foregroundStyle(.blue)
                        .lineLimit(1)
                } else if let preview = session.preview, !preview.isEmpty {
                    Text(preview)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 6) {
                    Text(session.surface == "cli" ? "CLI" : "VAV")
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(.quaternary, in: Capsule())
                    Text(session.dirLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var statusColor: Color {
        if generating { return .blue }
        switch session.status {
        case "done": return .green
        default: return .gray.opacity(0.4)
        }
    }
}
