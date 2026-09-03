import PhotosUI
import SwiftUI
import UIKit

/// Recent transcript + composer, matching the desktop Agent log (not iMessage).
struct SessionDetailView: View {
    let session: RemoteSession
    @EnvironmentObject private var client: RemoteClient
    @State private var draft = ""
    @State private var queue: [QueuedSend] = []
    @State private var pickWorkspace = false
    @State private var renameTitle = ""
    @State private var showRename = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingImages: [PendingImage] = []
    @FocusState private var composerFocused: Bool

    private var messages: [RemoteThreadMessage] {
        client.threads[session.id] ?? []
    }

    private var load: RemoteClient.ThreadLoad {
        client.threadLoad[session.id] ?? .unknown
    }

    private var run: RemoteSessionControls? {
        client.controls[session.id]
    }

    private var liveSession: RemoteSession {
        client.sessions.first(where: { $0.id == session.id }) ?? session
    }

    private var liveStatus: String {
        liveSession.status
    }

    private var isRunning: Bool { liveStatus == "running" || client.isGenerating(session.id) }

    private var liveThinking: String { client.thinkingDrafts[session.id] ?? "" }
    private var liveDraft: String { client.drafts[session.id] ?? "" }
    private var liveBlocks: [RemoteThreadBlock] { client.liveBlocks[session.id] ?? [] }
    private var showLiveTurn: Bool {
        client.awaiting[session.id] == nil && (isRunning || !liveBlocks.isEmpty || !liveThinking.isEmpty || !liveDraft.isEmpty)
    }

    private var isConnected: Bool {
        if case .connected = client.state { return true }
        return false
    }

    private var canSend: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasImages = !pendingImages.isEmpty
        return (hasText || hasImages) && isConnected && !(isRunning && queue.count >= 20)
    }

    var body: some View {
        VStack(spacing: 0) {
            transcript
            if !queue.isEmpty { queueStrip }
            composer
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle(liveSession.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarRole(.editor)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isAwaiting || isRunning {
                    Text(statusLabel)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .fixedSize()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if client.host?.capabilities.favorite == true {
                        Button {
                            client.setFavorite(conversationId: session.id, favorite: !liveSession.favorite)
                        } label: {
                            Label(
                                liveSession.favorite ? "取消收藏" : "收藏",
                                systemImage: liveSession.favorite ? "star.slash" : "star"
                            )
                        }
                    }
                    if client.host?.capabilities.pin == true {
                        Button {
                            client.setPinned(conversationId: session.id, pinned: !liveSession.pinned)
                        } label: {
                            Label(
                                liveSession.pinned ? "取消置顶" : "置顶",
                                systemImage: liveSession.pinned ? "pin.slash" : "pin"
                            )
                        }
                    }
                    Button("重命名") {
                        renameTitle = liveSession.title
                        showRename = true
                    }
                    Button("换文件夹") { pickWorkspace = true }
                    Button("新建临时工作区") {
                        client.setWorkspace(conversationId: session.id, temp: true)
                    }
                    if isRunning {
                        Button("停止生成", role: .destructive) {
                            client.cancel(conversationId: session.id)
                        }
                    }
                    Button("归档", role: .destructive) {
                        client.archive(conversationId: session.id)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("会话操作")
            }
        }
        .sheet(isPresented: $pickWorkspace) {
            WorkspacePickerView(conversationId: session.id)
                .environmentObject(client)
        }
        .alert("重命名会话", isPresented: $showRename) {
            TextField("标题", text: $renameTitle)
            Button("取消", role: .cancel) {}
            Button("保存") {
                let title = renameTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                if !title.isEmpty { client.rename(conversationId: session.id, title: title) }
            }
        }
        .onAppear {
            client.setViewingConversation(session.id)
            client.requestThread(conversationId: session.id)
            client.requestControls(conversationId: session.id)
        }
        .onDisappear {
            client.setViewingConversation(nil, ifCurrent: session.id)
        }
        .onChange(of: isConnected) { _, on in
            if on {
                client.requestThread(conversationId: session.id)
                client.requestControls(conversationId: session.id)
            }
        }
        .onChange(of: liveStatus) { _, next in
            if next != "running" { flushQueue() }
        }
        .onChange(of: photoItems) { _, items in
            Task { await ingestPhotos(items) }
        }
        .alert("发送失败", isPresented: Binding(
            get: { client.sendErrorConversationId == session.id && client.sendError != nil },
            set: { if !$0 { client.clearSendError() } }
        )) {
            Button("好", role: .cancel) { client.clearSendError() }
        } message: {
            Text(client.sendError ?? "")
        }
    }

    // MARK: - Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                    if !isConnected && messages.isEmpty {
                        offlineChrome
                    } else if load == .loading && messages.isEmpty {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在同步对话…公网会慢一些，请稍等")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                    } else if load == .loading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在更新对话…")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                    } else if load == .offline && messages.isEmpty {
                        offlineChrome
                    } else if messages.isEmpty && !isRunning {
                        emptyChrome
                    }

                    ForEach(messages) { message in
                        ThreadTurn(message: message) { toolCallId, answer in
                            client.reply(conversationId: session.id, toolCallId: toolCallId, answer: answer)
                        }
                        .id(message.id)
                    }

                    if let waiting = client.awaiting[session.id], !messages.contains(where: { $0.blocks?.contains(where: { $0.kind == "awaiting" && $0.id == waiting.id }) == true }) {
                        AwaitingCard(block: waiting) { toolCallId, answer in
                            client.reply(conversationId: session.id, toolCallId: toolCallId, answer: answer)
                        }
                        .id("awaiting")
                    }

                    if showLiveTurn {
                        LiveAgentTurn(blocks: liveBlocks, thinking: liveThinking, draft: liveDraft) { toolCallId, answer in
                            client.reply(conversationId: session.id, toolCallId: toolCallId, answer: answer)
                        }
                        .id("generating")
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: messages.count) { _, _ in
                scrollToEnd(proxy)
            }
            .onChange(of: isRunning) { _, _ in
                scrollToEnd(proxy)
            }
            .onChange(of: liveDraft) { _, _ in
                scrollToEnd(proxy)
            }
            .onChange(of: liveThinking) { _, _ in
                scrollToEnd(proxy)
            }
            .onChange(of: liveBlocks.count) { _, _ in
                scrollToEnd(proxy)
            }
        }
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        let anchor: String? = {
            if client.awaiting[session.id] != nil { return "awaiting" }
            if isRunning { return "generating" }
            return messages.last?.id
        }()
        guard let anchor else { return }
        withAnimation(.easeOut(duration: 0.18)) {
            proxy.scrollTo(anchor, anchor: .bottom)
        }
    }

    private var offlineChrome: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("还没连上电脑")
                .font(.system(size: 15, weight: .semibold))
            Text(linkHint)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("重试连接") { client.connectIfNeeded() }
                .font(.system(size: 15, weight: .medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 36)
    }

    private var linkHint: String {
        if case .connecting = client.state { return "正在经公网中继连接…离开 Wi‑Fi 时会慢一些。" }
        if case .disconnected(let error) = client.state, let error, !error.isEmpty { return error }
        return "离开家里的 Wi‑Fi 后，手机要经公网中继才能连到这台电脑。请确认电脑没休眠、VAV 开着。"
    }

    private var emptyChrome: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Harnessed by VAV")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.secondary)
            workspaceProse
            if load == .unavailable {
                Text("对话同步超时。下拉返回再进，或到设置里点立即重连。")
                    .font(.system(size: 13))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 36)
    }

    private var workspaceProse: some View {
        let label = run?.dirLabel.isEmpty == false ? (run?.dirLabel ?? "") : liveSession.dirLabel
        let name = liveSession.temporary ? "临时工作区" : (label.isEmpty ? "未选择文件夹" : label)
        return VStack(alignment: .leading, spacing: 8) {
            Text("工作区是 \(name)。")
                .font(.system(size: 15))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 16) {
                Button("换文件夹") { pickWorkspace = true }
                Button("临时目录") { client.setWorkspace(conversationId: session.id, temp: true) }
            }
            .font(.system(size: 15, weight: .medium))
        }
    }

    // MARK: - Queue

    private var queueStrip: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(queue) { item in
                HStack(spacing: 8) {
                    Image(systemName: "text.bubble")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.tertiary)
                    Text(item.preview)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Button {
                        queue.removeAll { $0.id == item.id }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
                    .accessibilityLabel("移除排队消息")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
    }

    // MARK: - Composer

    /// Same card as desktop `.composer-box`: prompt on top, tools + send on the baseline.
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(pendingImages) { image in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: image.preview)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 56, height: 56)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                Button {
                                    pendingImages.removeAll { $0.id == image.id }
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 8, weight: .bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 16, height: 16)
                                        .background(.black.opacity(0.55), in: Circle())
                                }
                                .buttonStyle(.plain)
                                .offset(x: 4, y: -4)
                                .accessibilityLabel("移除照片")
                            }
                        }
                    }
                }
            }

            TextField(placeholder, text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .lineLimit(3...8)
                .focused($composerFocused)
                .frame(minHeight: 66, alignment: .topLeading)

            HStack(spacing: 4) {
                PhotosPicker(selection: $photoItems, maxSelectionCount: 4, matching: .images) {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressButtonStyle())
                .disabled(!isConnected || pendingImages.count >= 4)
                .accessibilityLabel("添加照片")

                if let run {
                    SessionRunBar(controls: run) { key, value in
                        if key == "fast" {
                            client.setFast(conversationId: session.id, fast: value == "1")
                        } else {
                            client.configure(conversationId: session.id, patch: [key: value])
                        }
                    }
                }

                Spacer(minLength: 8)

                if isRunning {
                    Button {
                        client.cancel(conversationId: session.id)
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.primary)
                            .frame(width: 32, height: 32)
                            .background(
                                Color.primary.opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                            )
                    }
                    .buttonStyle(PressButtonStyle())
                    .accessibilityLabel("停止")
                }

                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(canSend ? Color.white : Color.secondary.opacity(0.45))
                        .frame(width: 32, height: 32)
                        .background(
                            canSend ? Color.accentColor : Color.primary.opacity(0.06),
                            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                        )
                }
                .buttonStyle(PressButtonStyle())
                .disabled(!canSend)
                .accessibilityLabel(isRunning ? "加入队列" : "发送")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(
            Color.primary.opacity(composerFocused ? 0.055 : 0.04),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.10), lineWidth: 1)
        )
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private var placeholder: String {
        if !isConnected { return "等待连接到 Mac…" }
        if isRunning {
            return queue.count >= 20 ? "消息队列已满（最多 20 条）" : "输入消息…（流式中发送将排队）"
        }
        return "给 Agent 发消息…"
    }

    private var isAwaiting: Bool { client.awaiting[session.id] != nil }

    private var statusLabel: String {
        if isAwaiting { return "等待回复" }
        if isRunning { return "Generating…" }
        switch liveStatus {
        case "done": return "已完成"
        default: return "空闲"
        }
    }

    private func submit() {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let images = pendingImages.map(\.payload)
        draft = ""
        pendingImages = []
        photoItems = []
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if isRunning {
            queue.append(QueuedSend(
                text: text.isEmpty && !images.isEmpty ? "（附件）" : text,
                images: images
            ))
            return
        }
        client.send(conversationId: session.id, text: text, images: images)
    }

    @MainActor
    private func ingestPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        var next = pendingImages
        for item in items {
            if next.count >= 4 { break }
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let encoded = PendingImage.encode(data)
            else { continue }
            next.append(encoded)
        }
        pendingImages = next
        photoItems = []
    }

    private func flushQueue() {
        guard !isRunning, let next = queue.first else { return }
        queue.removeFirst()
        client.send(conversationId: session.id, text: next.text, images: next.images)
    }
}

// MARK: - Run bar (mode / permission / agent / model / thinking)

/// [mode · permission]  agent+model  [thinking · Fast] — same chrome as desktop.
private struct SessionRunBar: View {
    let controls: RemoteSessionControls
    let onPick: (String, String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                if !controls.modes.isEmpty {
                    iconMenu(
                        systemImage: modeSymbol(controls.mode),
                        rows: controls.modes,
                        selected: controls.mode,
                        key: "mode",
                        label: controls.label(in: controls.modes, id: controls.mode, fallback: "Mode"),
                        caret: true
                    )
                }
                if !controls.approvals.isEmpty {
                    iconMenu(
                        systemImage: approvalSymbol(controls.approval),
                        rows: controls.approvals,
                        selected: controls.approval,
                        key: "approvalMode",
                        label: controls.label(in: controls.approvals, id: controls.approval, fallback: "Normal"),
                        caret: true
                    )
                }

                modelPicker

                if let thinking = controls.thinking, !controls.thinkingLevels.isEmpty {
                    Menu {
                        pickerRows(controls.thinkingLevels, selected: thinking, key: "thinkingLevel")
                    } label: {
                        ThinkingLevelIcon(level: thinking)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("思考深度 · \(controls.label(in: controls.thinkingLevels, id: thinking, fallback: thinking))")
                }

                if let fast = controls.fast {
                    Button {
                        onPick("fast", fast ? "0" : "1")
                    } label: {
                        Text("Fast")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(fast ? Color.accentColor : Color.secondary)
                            .padding(.horizontal, 7)
                            .frame(height: 28)
                    }
                    .buttonStyle(PressButtonStyle())
                    .accessibilityLabel(fast ? "Fast 开" : "Fast 关")
                }
            }
        }
        .foregroundStyle(.secondary)
    }

    private var modelPicker: some View {
        Menu {
            if !controls.agents.isEmpty {
                Section("Agent") {
                    pickerRows(controls.agents, selected: controls.agent, key: "agent", disabled: controls.agentLocked)
                }
            }
            if !controls.models.isEmpty {
                Section("模型") {
                    pickerRows(controls.models, selected: controls.model, key: "model")
                }
            }
        } label: {
            HStack(spacing: 5) {
                AgentMark(name: controls.label(in: controls.agents, id: controls.agent, fallback: "VAV"))
                    Text(modelTitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .frame(height: 28)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(controls.label(in: controls.agents, id: controls.agent, fallback: "VAV")) · \(modelTitle)")
    }

    private var modelTitle: String {
        controls.label(
            in: controls.models,
            id: controls.model,
            fallback: controls.model.isEmpty ? "Default" : controls.model
        )
    }

    @ViewBuilder
    private func pickerRows(
        _ rows: [RemoteChoice],
        selected: String?,
        key: String,
        disabled: Bool = false
    ) -> some View {
        ForEach(rows) { row in
            Button {
                onPick(key, row.id)
            } label: {
                if row.id == selected {
                    Label(row.label, systemImage: "checkmark")
                } else {
                    Text(row.label)
                }
            }
            .disabled(disabled)
        }
    }

    private func iconMenu(
        systemImage: String,
        rows: [RemoteChoice],
        selected: String?,
        key: String,
        label: String,
        caret: Bool
    ) -> some View {
        Menu {
            pickerRows(rows, selected: selected, key: key)
        } label: {
            HStack(spacing: 2) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .medium))
                if caret {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(minWidth: 28, minHeight: 28)
            .padding(.horizontal, caret ? 4 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func modeSymbol(_ id: String?) -> String {
        let value = (id ?? "").lowercased()
        if value.contains("plan") { return "checklist" }
        if value.contains("ask") { return "bubble.left" }
        if value.contains("build") || value.contains("edit") { return "hammer" }
        return "cpu"
    }

    private func approvalSymbol(_ id: String) -> String {
        switch id {
        case "bypass": return "airplane"
        case "edit": return "book"
        default: return "shield"
        }
    }
}

private struct AgentMark: View {
    let name: String

    var body: some View {
        if name.caseInsensitiveCompare("VAV") == .orderedSame {
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 16, height: 16)
        } else {
            Text(String(name.prefix(1)).uppercased())
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .frame(width: 16, height: 16)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }
}

private struct ThinkingLevelIcon: View {
    let level: String

    private var filled: Int {
        switch level {
        case "low": return 1
        case "medium": return 2
        case "high": return 3
        case "max": return 4
        default: return 0
        }
    }

    var body: some View {
        VStack(spacing: 1.2) {
            ForEach((0..<4).reversed(), id: \.self) { index in
                Capsule()
                    .fill(barColor(index))
                    .frame(width: 12, height: 1.2)
            }
        }
        .frame(width: 14, height: 14)
    }

    private func barColor(_ index: Int) -> Color {
        let n = index + 1
        if n == filled { return Color.accentColor }
        if n < filled { return Color.primary.opacity(0.85) }
        return Color.primary.opacity(0.15)
    }
}

private struct LiveAgentTurn: View {
    let blocks: [RemoteThreadBlock]
    let thinking: String
    let draft: String
    var onReply: (String, String) -> Void = { _, _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Agent")
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.2)
                .foregroundStyle(Color.accentColor)
            if !blocks.isEmpty {
                AgentBlockStack(blocks: blocks, live: true, onReply: onReply)
            } else if !thinking.isEmpty || !draft.isEmpty {
                if !thinking.isEmpty { ThinkingBlock(text: thinking, live: true) }
                if !draft.isEmpty { AgentMarkdown(source: draft) }
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Generating…")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Log turns

private struct ThreadTurn: View {
    let message: RemoteThreadMessage
    var onReply: (String, String) -> Void = { _, _ in }
    @State private var expanded = false

    private var isUser: Bool { message.role == "user" }
    private var isSystem: Bool { message.role == "system" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !isSystem {
                Text(isUser ? "You" : "Agent")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.2)
                    .foregroundStyle(isUser ? Color.secondary : Color.accentColor)
            }
            if isSystem {
                Text(message.text)
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
            } else if isUser {
                userBody
            } else if let blocks = message.blocks, !blocks.isEmpty {
                AgentBlockStack(blocks: blocks, onReply: onReply)
            } else {
                AgentMarkdown(source: message.text)
            }
            if message.cancelled == true {
                Text("已停止")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
            }
            if let error = message.error, !error.isEmpty {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextMenu {
            Button("拷贝") { UIPasteboard.general.string = message.text }
        }
    }

    @ViewBuilder
    private var userBody: some View {
        let lines = message.text.split(whereSeparator: \.isNewline).count
        let collapsible = message.text.count > 400 || lines > 8
        Text(message.text)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.primary)
            .textSelection(.enabled)
            .lineLimit(collapsible && !expanded ? 4 : nil)
        if collapsible {
            Button(expanded ? "收起" : "展开") { expanded.toggle() }
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
        }
    }
}

private struct QueuedSend: Identifiable {
    let id = UUID()
    let text: String
    var images: [[String: String]] = []
    var preview: String { text }
}

private struct PendingImage: Identifiable {
    let id = UUID()
    let preview: UIImage
    let payload: [String: String]

    /// JPEG under the remote line budget (`SEND_IMAGE_DATA_CAP` ≈ 180k base64).
    static func encode(_ data: Data) -> PendingImage? {
        guard let image = UIImage(data: data) else { return nil }
        let scaled = image.preparedForRemote()
        var quality: CGFloat = 0.72
        var jpeg = scaled.jpegData(compressionQuality: quality)
        while let bytes = jpeg, bytes.base64EncodedString().count > 180_000, quality > 0.28 {
            quality -= 0.12
            jpeg = scaled.jpegData(compressionQuality: quality)
        }
        guard let jpeg else { return nil }
        let encoded = jpeg.base64EncodedString()
        guard encoded.count <= 180_000, !encoded.isEmpty else { return nil }
        return PendingImage(
            preview: scaled,
            payload: ["name": "photo.jpg", "mime": "image/jpeg", "data": encoded]
        )
    }
}

private extension UIImage {
    func preparedForRemote(maxEdge: CGFloat = 1280) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxEdge, longest > 0 else { return self }
        let scale = maxEdge / longest
        let next = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: next)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: next))
        }
    }
}

private struct PressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
