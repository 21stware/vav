import SwiftUI

/// Restricted folder picker: home / recents / current, directories only.
struct WorkspacePickerView: View {
    let conversationId: String
    @EnvironmentObject private var client: RemoteClient
    @Environment(\.dismiss) private var dismiss

    private var dirs: RemoteDirs? { client.dirLists[conversationId] }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("新建临时工作区") {
                        client.setWorkspace(conversationId: conversationId, temp: true)
                        dismiss()
                    }
                    if let recents = client.host?.recentDirs, !recents.isEmpty {
                        ForEach(recents) { row in
                            Button {
                                client.setWorkspace(conversationId: conversationId, path: row.path)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.label).foregroundStyle(.primary)
                                    Text(row.path)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                        }
                    }
                } header: {
                    Text("这台电脑上的文件夹")
                } footer: {
                    Text("手机不能读文件内容、不能开终端。只能给这条会话换 Host 上的工作目录。")
                }

                if let dirs {
                    Section(dirs.path.isEmpty ? "位置" : dirs.path) {
                        if let parent = dirs.parent {
                            Button("上级目录") { client.browse(conversationId: conversationId, path: parent) }
                        }
                        ForEach(dirs.entries) { entry in
                            Button {
                                client.browse(conversationId: conversationId, path: entry.path)
                            } label: {
                                Label(entry.name, systemImage: "folder")
                            }
                            .swipeActions(edge: .trailing) {
                                Button("使用") {
                                    client.setWorkspace(conversationId: conversationId, path: entry.path)
                                    dismiss()
                                }
                                .tint(.accentColor)
                            }
                        }
                    }
                }
            }
            .navigationTitle("工作区")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if let path = dirs?.path, !path.isEmpty {
                        Button("使用这里") {
                            client.setWorkspace(conversationId: conversationId, path: path)
                            dismiss()
                        }
                    }
                }
            }
            .onAppear { client.browse(conversationId: conversationId) }
        }
    }
}
