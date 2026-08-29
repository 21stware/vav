import SwiftUI

/// Structured agent-log blocks, matching the desktop transcript (not chat bubbles).
struct AgentBlockStack: View {
    let blocks: [RemoteThreadBlock]
    var live: Bool = false
    let onReply: (String, String) -> Void

    var body: some View {
        let split = live ? (process: [RemoteThreadBlock](), conclusion: AssistantLog.visible(blocks)) : AssistantLog.split(blocks)
        return VStack(alignment: .leading, spacing: 12) {
            if !split.process.isEmpty {
                ThinkingProcessShell(blocks: split.process, onReply: onReply)
            }
            ForEach(Array(split.conclusion.enumerated()), id: \.offset) { _, block in
                blockView(block, liveReasoning: live && block.kind == "reasoning" && block.stableId == lastReasoning)
            }
        }
    }

    private var lastReasoning: String? {
        AssistantLog.visible(blocks).last(where: { $0.kind == "reasoning" })?.stableId
    }

    @ViewBuilder
    private func blockView(_ block: RemoteThreadBlock, liveReasoning: Bool) -> some View {
        switch block.kind {
        case "text":
            if let text = block.text, !text.isEmpty {
                AgentMarkdown(source: text)
            }
        case "reasoning":
            if let text = block.text, !text.isEmpty {
                ThinkingBlock(text: text, live: liveReasoning)
            }
        case "plan":
            PlanBlockView(title: block.title ?? "Plan", steps: block.steps ?? [])
        case "tool":
            ToolRow(block: block)
        case "awaiting":
            AwaitingCard(block: block, onReply: onReply)
        default:
            if let text = block.text, !text.isEmpty {
                AgentMarkdown(source: text)
            }
        }
    }
}

struct ThinkingBlock: View {
    let text: String
    var live: Bool = false
    @State private var open: Bool

    init(text: String, live: Bool = false) {
        self.text = text
        self.live = live
        _open = State(initialValue: live)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                open.toggle()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(live ? "Thinking…" : "Thinking")
                        .font(.system(size: 12, weight: .semibold))
                    if live {
                        ProgressView()
                            .controlSize(.mini)
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            if open {
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onChange(of: live) { _, next in
            if next { open = true }
        }
    }
}

private struct ToolRow: View {
    let block: RemoteThreadBlock

    var body: some View {
        HStack(spacing: 8) {
            statusDot
            Text(displayName)
                .font(.system(size: 13, weight: .semibold))
            Text(block.summary ?? "")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private var displayName: String {
        if let name = block.name, !name.isEmpty { return name }
        return AssistantLog.toolLabel(block.tool)
    }

    private var statusDot: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
    }

    private var color: Color {
        switch block.status {
        case "executing", "pending": return .blue
        case "error": return .red
        case "skipped", "expired": return .secondary
        default: return .green
        }
    }
}

struct PlanBlockView: View {
    let title: String
    let steps: [RemotePlanStep]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
            ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 14))
                        .foregroundStyle(step.done ? Color.accentColor : Color.secondary)
                    Text(step.text)
                        .font(.system(size: 14))
                        .strikethrough(step.done)
                        .foregroundStyle(step.done ? Color.secondary : Color.primary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct AwaitingCard: View {
    let block: RemoteThreadBlock
    let onReply: (String, String) -> Void
    @State private var custom = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(block.title ?? "需要确认")
                .font(.system(size: 14, weight: .semibold))
            if let prompt = block.prompt, !prompt.isEmpty {
                Text(prompt)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            if let choices = block.choices, !choices.isEmpty {
                ForEach(choices) { choice in
                    Button(choice.label) {
                        onReply(block.id ?? "", choice.id)
                    }
                    .buttonStyle(.bordered)
                }
            } else {
                HStack {
                    TextField("回复…", text: $custom)
                        .textFieldStyle(.roundedBorder)
                    Button("发送") {
                        let text = custom.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        onReply(block.id ?? "", text)
                        custom = ""
                    }
                    .disabled(custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if isApproval {
                    HStack {
                        Button("允许") { onReply(block.id ?? "", "Allow") }
                            .buttonStyle(.borderedProminent)
                        Button("拒绝", role: .destructive) { onReply(block.id ?? "", "Deny") }
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(0.25), lineWidth: 1)
        )
    }

    private var isApproval: Bool {
        let tool = block.tool ?? ""
        return tool == "plan_doc" || tool == "request" || (block.choices?.isEmpty ?? true)
    }
}

enum AssistantLog {
    static func visible(_ blocks: [RemoteThreadBlock]) -> [RemoteThreadBlock] {
        blocks.filter { block in
            switch block.kind {
            case "plan": return false
            case "tool" where block.tool == "plan": return false
            case "text", "reasoning":
                return !(block.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            default:
                return true
            }
        }
    }

    static func split(_ blocks: [RemoteThreadBlock]) -> (process: [RemoteThreadBlock], conclusion: [RemoteThreadBlock]) {
        let rows = visible(blocks)
        guard let lastText = rows.lastIndex(where: { $0.kind == "text" && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            return ([], rows)
        }
        let lastTool = rows.lastIndex(where: { $0.kind == "tool" || $0.kind == "awaiting" })
        var cut: Int?
        if let lastTool {
            if lastTool < lastText {
                for index in (lastTool + 1)...lastText where rows[index].kind == "text" {
                    if !(rows[index].text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        cut = index
                        break
                    }
                }
            }
            if cut == nil { return ([], rows) }
        } else {
            cut = rows.firstIndex(where: { $0.kind == "text" && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        }
        guard let cut else { return ([], rows) }
        var process = Array(rows[..<cut])
        var conclusion = Array(rows[cut...])
        while conclusion.last?.kind == "reasoning" {
            process.append(conclusion.removeLast())
        }
        if process.isEmpty || conclusion.isEmpty { return ([], rows) }
        return (process, conclusion)
    }

    static func toolLabel(_ tool: String?) -> String {
        switch tool {
        case "terminal": return "终端"
        case "fs_read", "read_file": return "读取文件"
        case "fs_write", "write_file": return "写入文件"
        case "fs_list": return "列出目录"
        case "web_search": return "网页搜索"
        case "web_fetch": return "抓取网页"
        case "doc_search", "grep": return "文档检索"
        case "ask_user_question", "request": return "提问"
        case "load_skill": return "加载技能"
        case "switch_mode": return "切换到编辑"
        case "task": return "子任务"
        case "plan_doc": return "计划文档"
        case "wait": return "等待输出"
        case nil, "": return "工具"
        default:
            return tool!.replacingOccurrences(of: "_", with: " ")
        }
    }
}

struct ThinkingProcessShell: View {
    let blocks: [RemoteThreadBlock]
    let onReply: (String, String) -> Void
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                open.toggle()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text("思考过程")
                        .font(.system(size: 12, weight: .semibold))
                    Text("\(blocks.count) 步")
                        .font(.system(size: 12))
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            if open {
                AgentBlockStack(blocks: blocks, live: true, onReply: onReply)
            }
        }
    }
}
