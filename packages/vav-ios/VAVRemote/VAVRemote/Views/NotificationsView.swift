import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject private var client: RemoteClient

    var body: some View {
        NavigationStack {
            List {
                ForEach(client.notifications) { item in
                    Button {
                        client.openFromNotification(item)
                    } label: {
                        NotificationRow(item: item, showTitle: true)
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            client.dismissNotification(item)
                        } label: {
                            Label("清除", systemImage: "trash")
                        }
                    }
                }
                .onDelete { offsets in
                    let items = offsets.map { client.notifications[$0] }
                    for item in items { client.dismissNotification(item) }
                }
            }
            .overlay {
                if client.notifications.isEmpty {
                    ContentUnavailableView(
                        "暂无通知",
                        systemImage: "bell",
                        description: Text("完成后会更新对应会话。点一条通知即可跳过去。")
                    )
                }
            }
            .navigationTitle("通知")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { ConnectionBadge(compact: true) }
            }
        }
    }
}

struct NotificationRow: View {
    let item: RemoteNotificationItem
    let showTitle: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(item.kindLabel)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(badgeColor.opacity(0.15), in: Capsule())
                    .foregroundStyle(badgeColor)
                if showTitle {
                    Text(item.title).font(.subheadline.weight(.medium)).lineLimit(1)
                }
                Spacer()
                Text(timeLabel).font(.caption2).foregroundStyle(.secondary)
            }
            if !item.body.isEmpty {
                Text(item.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var badgeColor: Color {
        switch item.kind {
        case "turn-complete": return .green
        case "ask": return .blue
        case "approval": return .orange
        case "request": return .purple
        default: return .gray
        }
    }

    private var timeLabel: String {
        let date = Date(timeIntervalSince1970: item.at / 1000)
        return date.formatted(date: .omitted, time: .shortened)
    }
}
