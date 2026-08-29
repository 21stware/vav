import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var client: RemoteClient
    @State private var confirmUnpair = false

    var body: some View {
        NavigationStack {
            List {
                Section("连接") {
                    LabeledContent("电脑", value: client.host?.name ?? client.pairedHost)
                    LabeledContent("状态") { ConnectionBadge() }
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
                    Button("解除配对", role: .destructive) { confirmUnpair = true }
                } footer: {
                    Text("解除后需在 Mac 上重新扫码。同一张二维码可以同时连多台手机。离开家里 Wi‑Fi 时走公网中继，电脑要开着且不要休眠。通知只在 App 打开时送达。")
                }
            }
            .navigationTitle("设置")
            .confirmationDialog("解除与 Mac 的配对？", isPresented: $confirmUnpair, titleVisibility: .visible) {
                Button("解除配对", role: .destructive) { client.unpair() }
            }
        }
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
