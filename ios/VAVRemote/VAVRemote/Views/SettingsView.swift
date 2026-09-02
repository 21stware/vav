import SwiftUI
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var client: RemoteClient
    @State private var showAdd = false
    @State private var pendingForget: Pairing?
    @State private var showExport = false
    @State private var copied = false
    @State private var exportURL: URL?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(client.pairings) { pairing in
                        Button {
                            client.activate(pairing)
                        } label: {
                            HostRow(pairing: pairing, active: client.isActive(pairing))
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("解除", role: .destructive) { pendingForget = pairing }
                        }
                    }
                    Button {
                        showAdd = true
                    } label: {
                        Label("添加电脑", systemImage: "plus")
                    }
                } header: {
                    Text("电脑")
                } footer: {
                    Text("这台手机可以保存多台电脑，点一下切换。同一张二维码也可以给多台手机用。离开家里 Wi‑Fi 时走公网中继，电脑要开着且不要休眠。")
                }

                Section("当前连接") {
                    LabeledContent("电脑", value: client.host?.name ?? client.pairedHost)
                    LabeledContent("状态") { ConnectionBadge() }
                    if let at = client.lastSyncAt {
                        LabeledContent("最近同步", value: at.formatted(date: .omitted, time: .standard))
                    }
                    if let platform = client.host?.platform {
                        LabeledContent("系统", value: platform)
                    }
                    Button("立即重连") { client.connectIfNeeded() }
                }

                if let host = client.host {
                    Section {
                        LabeledContent("Agent", value: host.defaults.agent)
                        LabeledContent("模型", value: host.defaults.model.isEmpty ? "Default" : host.defaults.model)
                        LabeledContent("思考", value: thinkingLabel(host.defaults.thinking))
                        LabeledContent("权限", value: approvalLabel(host.defaults.approval))
                    } header: {
                        Text("这台电脑的默认配置")
                    } footer: {
                        Text("新会话使用电脑上的默认 Agent / 模型 / 思考 / 权限。每条会话里可以再改，和桌面一致。")
                    }

                    Section {
                        cap("新建 / 发送 / 停止", on: host.capabilities.cancel)
                        cap("回答提问与批准", on: host.capabilities.reply)
                        cap("重命名 / 归档", on: host.capabilities.rename)
                        cap("选择工作区", on: host.capabilities.workdirPick)
                    } header: {
                        Text("手机可以做的事")
                    }

                    Section {
                        cap("附件与截图", on: host.capabilities.attachments)
                        cap("读文件内容", on: host.capabilities.fsRead)
                        cap("终端", on: host.capabilities.pty)
                        cap("密钥与登录", on: host.capabilities.keys)
                    } header: {
                        Text("需要在电脑上做的事")
                    } footer: {
                        Text("工作区、Agent、密钥都在 Host 上。手机是正规客户端，但 remote 不会把文件系统和终端放到手机沙盒里。")
                    }
                }

                Section {
                    Button("导出诊断日志") {
                        DiagLog.line("export requested")
                        exportURL = DiagLog.exportFile()
                        showExport = true
                    }
                    Button(copied ? "已复制" : "复制日志") {
                        UIPasteboard.general.string = DiagLog.snapshot()
                        copied = true
                    }
                    Button("清空日志", role: .destructive) {
                        DiagLog.clear()
                        copied = false
                    }
                } header: {
                    Text("诊断日志")
                } footer: {
                    Text("公网连不上时：打开 App 点「立即重连」，等它失败，再导出这份日志。令牌和密钥会被打码。诊断 build 4。")
                }
            }
            .navigationTitle("设置")
            .sheet(isPresented: $showAdd) {
                PairingView(mode: .add)
                    .environmentObject(client)
            }
            .sheet(isPresented: $showExport) {
                if let exportURL {
                    DiagExportView(url: exportURL)
                }
            }
            .confirmationDialog(
                forgetTitle,
                isPresented: Binding(
                    get: { pendingForget != nil },
                    set: { if !$0 { pendingForget = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("解除配对", role: .destructive) {
                    if let pendingForget { client.forget(pendingForget) }
                    pendingForget = nil
                }
            }
        }
    }

    private var forgetTitle: String {
        if let name = pendingForget?.displayName {
            return "解除与 \(name) 的配对？"
        }
        return "解除配对？"
    }

    private func cap(_ title: String, on: Bool) -> some View {
        LabeledContent(title, value: on ? "可以" : "仅电脑")
    }

    private func thinkingLabel(_ value: String?) -> String {
        switch value {
        case "off": return "关闭"
        case "low": return "低"
        case "medium": return "中"
        case "high": return "高"
        case "max": return "最高"
        default: return value ?? "—"
        }
    }

    private func approvalLabel(_ value: String) -> String {
        switch value {
        case "bypass": return "Bypass"
        case "edit": return "Read"
        default: return "Normal"
        }
    }
}

private struct HostRow: View {
    let pairing: Pairing
    let active: Bool

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pairing.displayName)
                    .foregroundStyle(.primary)
                Text(active ? "当前" : "已保存")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if active {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
    }
}
