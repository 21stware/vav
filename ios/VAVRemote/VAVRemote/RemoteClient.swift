import Combine
import Foundation
import Tcmobile
import UIKit
import UserNotifications

/// Connection manager: owns one TcmobileSession, a dedicated blocking read
/// thread, and foreground-driven reconnection. Published state mutates on the
/// main queue only. Scope is foreground-realtime — iOS suspends the socket in
/// the background, so `suspend()`/`connectIfNeeded()` follow the scene phase.
final class RemoteClient: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    enum State: Equatable {
        case unpaired
        case disconnected(String?) // optional last error
        case connecting
        case connected(host: String)
    }

    enum ThreadLoad: Equatable {
        /// No request yet.
        case unknown
        /// Waiting on Mac. Keep any cached messages on screen.
        case loading
        /// Mac replied (including an empty transcript).
        case ready
        /// Old Mac ignored `thread`, or the request timed out.
        case unavailable
        /// Tunnel is down — do not pretend this is an empty new session.
        case offline
    }

    @Published var selectedTab: RemoteTab = .sessions
    @Published private(set) var state: State = .unpaired
    @Published private(set) var sessions: [RemoteSession] = []
    @Published private(set) var notifications: [RemoteNotificationItem] = []
    @Published private(set) var threads: [String: [RemoteThreadMessage]] = [:]
    @Published private(set) var threadLoad: [String: ThreadLoad] = [:]
    @Published private(set) var controls: [String: RemoteSessionControls] = [:]
    @Published private(set) var generatingIds: Set<String> = []
    @Published private(set) var drafts: [String: String] = [:]
    @Published private(set) var thinkingDrafts: [String: String] = [:]
    @Published private(set) var liveBlocks: [String: [RemoteThreadBlock]] = [:]
    @Published private(set) var awaiting: [String: RemoteThreadBlock] = [:]
    @Published private(set) var host: RemoteHostSnapshot?
    @Published private(set) var dirLists: [String: RemoteDirs] = [:]
    @Published private(set) var creating = false
    /// Set when a notification or `created` should push a session.
    @Published private(set) var openConversationId: String?
    /// Send / reply failures for a specific conversation (never protocol noise).
    @Published var sendError: String?
    @Published var sendErrorConversationId: String?
    /// Create / pairing notices (not shown as 发送失败).
    @Published var notice: String?

    private var pairing: Pairing?
    private var session: TcmobileSession?
    /// Bumped on every disconnect; stale dial results / read loops bail out.
    private var generation = 0
    private var createGeneration = 0
    private var pendingThreads = Set<String>()

    override init() {
        pairing = PairingStore.load()
        super.init()
        if pairing != nil { state = .disconnected(nil) }
        UNUserNotificationCenter.current().delegate = self
    }

    var isPaired: Bool { pairing != nil }
    var pairedHost: String { pairing?.host ?? "Mac" }

    func isGenerating(_ conversationId: String) -> Bool {
        generatingIds.contains(conversationId)
    }

    func adopt(pairing: Pairing) {
        PairingStore.save(pairing)
        self.pairing = pairing
        teardown()
        connect()
    }

    func unpair() {
        PairingStore.clear()
        pairing = nil
        teardown()
        sessions = []
        notifications = []
        threads = [:]
        threadLoad = [:]
        controls = [:]
        generatingIds = []
        drafts = [:]
        thinkingDrafts = [:]
        liveBlocks = [:]
        awaiting = [:]
        host = nil
        dirLists = [:]
        creating = false
        openConversationId = nil
        sendError = nil
        sendErrorConversationId = nil
        notice = nil
        pendingThreads.removeAll()
        state = .unpaired
    }

    /// Call on launch and every scenePhase → .active transition.
    func connectIfNeeded() {
        guard pairing != nil else { return }
        switch state {
        case .connected, .connecting: return
        default: connect()
        }
    }

    /// Call on scenePhase → .background: the socket dies there anyway.
    func suspend() {
        teardown()
        if pairing != nil { state = .disconnected(nil) }
    }

    func send(conversationId: String, text: String, images: [[String: String]] = []) {
        guard let line = ClientFrame.send(conversationId: conversationId, text: text, images: images) else {
            failSend(conversationId, "消息为空")
            return
        }
        write(line)
        var rows = threads[conversationId] ?? []
        let caption = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = caption.isEmpty && !images.isEmpty ? "（附件）" : caption
        if !body.isEmpty {
            rows.append(
                RemoteThreadMessage(
                    id: "local-\(UUID().uuidString)",
                    role: "user",
                    text: body,
                    at: Date().timeIntervalSince1970 * 1000
                )
            )
            threads[conversationId] = rows
        }
        threadLoad[conversationId] = .ready
        setGenerating(conversationId, true)
        patchSession(conversationId, status: "running", preview: body)
    }

    func createSession() {
        guard !creating else { return }
        guard case .connected = state else { return }
        creating = true
        createGeneration += 1
        sendError = nil
        sendErrorConversationId = nil
        let gen = createGeneration
        guard let line = ClientFrame.create() else {
            creating = false
            return
        }
        write(line)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.createGeneration == gen, self.creating else { return }
            self.creating = false
            self.notice = "这台电脑上的 VAV 还不能从手机新建会话。请升级并重启桌面端。"
        }
    }

    func refreshSessions() {
        guard let line = ClientFrame.sessions() else { return }
        write(line)
    }

    func cancel(conversationId: String) {
        guard let line = ClientFrame.cancel(conversationId: conversationId) else { return }
        write(line)
        setGenerating(conversationId, false)
        drafts[conversationId] = nil
        thinkingDrafts[conversationId] = nil
        liveBlocks[conversationId] = nil
        awaiting[conversationId] = nil
    }

    func reply(conversationId: String, toolCallId: String, answer: String) {
        guard let line = ClientFrame.reply(conversationId: conversationId, toolCallId: toolCallId, answer: answer) else { return }
        write(line)
        awaiting[conversationId] = nil
        setGenerating(conversationId, true)
    }

    func rename(conversationId: String, title: String) {
        guard let line = ClientFrame.rename(conversationId: conversationId, title: title) else { return }
        write(line)
        if let index = sessions.firstIndex(where: { $0.id == conversationId }) {
            sessions[index] = sessions[index].patching(title: title)
        }
    }

    func archive(conversationId: String) {
        guard let line = ClientFrame.archive(conversationId: conversationId) else { return }
        write(line)
        sessions.removeAll { $0.id == conversationId }
        if openConversationId == conversationId { clearOpenRequest() }
    }

    func browse(conversationId: String, path: String? = nil) {
        guard let line = ClientFrame.browse(conversationId: conversationId, path: path) else { return }
        write(line)
    }

    func setWorkspace(conversationId: String, path: String? = nil, temp: Bool = false) {
        guard let line = ClientFrame.workspace(conversationId: conversationId, path: path, temp: temp) else { return }
        write(line)
    }

    func setFast(conversationId: String, fast: Bool) {
        guard let line = ClientFrame.encode([
            "type": "configure",
            "conversationId": conversationId,
            "fast": fast
        ]) else { return }
        write(line)
    }

    func requestControls(conversationId: String) {
        guard let line = ClientFrame.controls(conversationId: conversationId) else { return }
        write(line)
    }

    func configure(conversationId: String, patch: [String: String]) {
        guard let line = ClientFrame.configure(conversationId: conversationId, patch: patch) else { return }
        write(line)
    }

    func requestThread(conversationId: String) {
        guard case .connected = state else {
            if threadLoad[conversationId] != .ready {
                threadLoad[conversationId] = .offline
            }
            return
        }
        guard let line = ClientFrame.thread(conversationId: conversationId) else { return }
        if threadLoad[conversationId] != .ready {
            threadLoad[conversationId] = .loading
        }
        pendingThreads.insert(conversationId)
        write(line)
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self, self.generation == gen else { return }
            guard self.pendingThreads.contains(conversationId) else { return }
            self.pendingThreads.remove(conversationId)
            if self.threadLoad[conversationId] == .loading {
                self.threadLoad[conversationId] = .unavailable
                if self.threads[conversationId] == nil { self.threads[conversationId] = [] }
            }
        }
    }

    func openConversation(_ conversationId: String) {
        selectedTab = .sessions
        openConversationId = conversationId
    }

    func clearOpenRequest() {
        openConversationId = nil
    }

    func openFromNotification(_ item: RemoteNotificationItem) {
        openConversation(item.conversationId)
        dismissNotifications(for: item.conversationId)
    }

    func dismissNotification(_ item: RemoteNotificationItem) {
        notifications.removeAll { $0.id == item.id }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [item.id])
    }

    func dismissNotifications(for conversationId: String) {
        let ids = notifications.filter { $0.conversationId == conversationId }.map(\.id)
        notifications.removeAll { $0.conversationId == conversationId }
        if !ids.isEmpty {
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let conversationId = info["conversationId"] as? String
        DispatchQueue.main.async {
            if let conversationId, !conversationId.isEmpty {
                self.openConversation(conversationId)
                self.dismissNotifications(for: conversationId)
            }
            UNUserNotificationCenter.current().removeDeliveredNotifications(
                withIdentifiers: [response.notification.request.identifier]
            )
            completionHandler()
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }

    // --- internals (main queue unless noted) ---

    private func connect() {
        guard let pairing else { return }
        state = .connecting
        generation += 1
        let gen = generation
        let device = UIDevice.current.name
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var dialError: NSError?
            let session = TcmobileDial(pairing.token, &dialError)
            guard let session else {
                DispatchQueue.main.async {
                    guard let self, self.generation == gen else { return }
                    self.state = .disconnected(Self.describeLinkError(dialError))
                    self.scheduleReconnect()
                }
                return
            }
            do {
                guard let hello = ClientFrame.hello(secret: pairing.secret, device: device) else {
                    throw NSError(domain: "vav.remote", code: 1)
                }
                try session.writeLine(hello)
            } catch {
                session.close()
                DispatchQueue.main.async {
                    guard let self, self.generation == gen else { return }
                    self.state = .disconnected(error.localizedDescription)
                    self.scheduleReconnect()
                }
                return
            }
            DispatchQueue.main.async {
                guard let self, self.generation == gen else {
                    DispatchQueue.global().async { session.close() }
                    return
                }
                self.session = session
                self.state = .connected(host: pairing.host ?? "Mac")
                self.startReadThread(session: session, generation: gen)
                for id in self.threadLoad.keys {
                    self.requestThread(conversationId: id)
                    self.requestControls(conversationId: id)
                }
            }
        }
    }

    private func startReadThread(session: TcmobileSession, generation gen: Int) {
        let thread = Thread { [weak self] in
            while true {
                var error: NSError?
                let line = session.readLine(&error)
                if error != nil {
                    DispatchQueue.main.async {
                        guard let self, self.generation == gen else { return }
                        self.session = nil
                        self.abandonCreateIfNeeded()
                        self.state = .disconnected(nil)
                        self.scheduleReconnect()
                    }
                    return
                }
                guard let frame = ServerFrame.parse(line) else { continue }
                DispatchQueue.main.async {
                    guard let self, self.generation == gen else { return }
                    self.handle(frame)
                }
            }
        }
        thread.name = "vav-remote-read"
        thread.start()
    }

    private func handle(_ frame: ServerFrame) {
        switch frame {
        case .welcome:
            break
        case .host(let snapshot):
            host = snapshot
        case .sessions(let sessions):
            self.sessions = sessions
            finishTurnsIfIdle(in: sessions)
        case .thread(let conversationId, let messages):
            pendingThreads.remove(conversationId)
            threads[conversationId] = mergeThread(
                server: messages,
                local: threads[conversationId] ?? []
            )
            threadLoad[conversationId] = .ready
            if threadShowsCompletedTurn(threads[conversationId] ?? []) {
                setGenerating(conversationId, false)
                drafts[conversationId] = nil
                thinkingDrafts[conversationId] = nil
                liveBlocks[conversationId] = nil
            }
            if let waiting = lastAwaiting(in: threads[conversationId] ?? []) {
                awaiting[conversationId] = waiting
            } else if !isGenerating(conversationId) {
                awaiting[conversationId] = nil
            }
        case .turn(let turn):
            applyTurn(turn)
        case .dirs(let dirs):
            dirLists[dirs.conversationId] = dirs
        case .controls(let snapshot):
            controls[snapshot.conversationId] = snapshot
            if !snapshot.dirLabel.isEmpty, let index = sessions.firstIndex(where: { $0.id == snapshot.conversationId }) {
                sessions[index] = sessions[index].patching(
                    dirLabel: snapshot.dirLabel,
                    workdir: snapshot.workingDirectory,
                    temporary: snapshot.temporary
                )
            }
        case .notification(let item):
            notifications.insert(item, at: 0)
            if notifications.count > 200 { notifications.removeLast() }
            if item.kind == "turn-complete" {
                applyTurnFinished(item.conversationId)
            }
            postLocalNotification(item)
        case .created(let session):
            createGeneration += 1
            creating = false
            upsert(session)
            openConversation(session.id)
        case .sent:
            break
        case .pong:
            break
        case .error(let code, let message, let conversationId):
            if creating {
                createGeneration += 1
                creating = false
                notice = (message.contains("unrecognized") || code == "bad-request")
                    ? "请先重启电脑上的 VAV，再从手机新建会话。"
                    : (message.isEmpty ? code : message)
                return
            }
            if code == "auth" {
                teardown()
                state = .disconnected("配对被拒绝，请重新扫码")
                return
            }
            // Protocol / unknown-frame noise must never surface as 发送失败.
            if code == "bad-request", message.contains("unrecognized") {
                return
            }
            if let conversationId {
                pendingThreads.remove(conversationId)
                setGenerating(conversationId, false)
                if threadLoad[conversationId] == .loading {
                    threadLoad[conversationId] = .ready
                    if threads[conversationId] == nil { threads[conversationId] = [] }
                }
                failSend(conversationId, message.isEmpty ? code : message)
            }
        }
    }

    private func lastAwaiting(in messages: [RemoteThreadMessage]) -> RemoteThreadBlock? {
        for message in messages.reversed() {
            if let block = message.blocks?.last(where: { $0.kind == "awaiting" }) {
                return block
            }
        }
        return nil
    }

    private func applyTurn(_ turn: RemoteTurn) {
        switch turn.phase {
        case "running":
            setGenerating(turn.conversationId, true)
            if let blocks = turn.blocks { liveBlocks[turn.conversationId] = blocks }
            if let draft = turn.draft { drafts[turn.conversationId] = draft }
            if let thinking = turn.thinking { thinkingDrafts[turn.conversationId] = thinking }
            if turn.awaiting == nil { awaiting[turn.conversationId] = nil }
            patchSession(turn.conversationId, status: "running", preview: turn.draft ?? "Generating…")
        case "awaiting":
            setGenerating(turn.conversationId, false)
            if let blocks = turn.blocks { liveBlocks[turn.conversationId] = blocks }
            if let block = turn.awaiting { awaiting[turn.conversationId] = block }
            patchSession(turn.conversationId, status: "running", preview: "等待回复…")
        case "done", "error", "cancelled":
            setGenerating(turn.conversationId, false)
            awaiting[turn.conversationId] = nil
            // Keep thinking + draft until the sealed `thread` arrives so they
            // land together instead of flashing empty then popping in.
            if turn.phase == "error", let error = turn.error, !error.isEmpty {
                failSend(turn.conversationId, error)
            }
        default:
            break
        }
    }

    /// Turn finished: drop Generating, refresh the log, and reflect it in the list.
    private func applyTurnFinished(_ conversationId: String) {
        setGenerating(conversationId, false)
        if let index = sessions.firstIndex(where: { $0.id == conversationId }),
           sessions[index].status == "running" {
            sessions[index] = sessions[index].patching(status: "done")
        }
        requestThread(conversationId: conversationId)
        refreshSessions()
    }

    private func finishTurnsIfIdle(in sessions: [RemoteSession]) {
        for session in sessions where session.status != "running" && generatingIds.contains(session.id) {
            setGenerating(session.id, false)
            requestThread(conversationId: session.id)
        }
    }

    private func threadShowsCompletedTurn(_ messages: [RemoteThreadMessage]) -> Bool {
        guard let last = messages.last(where: { $0.role != "system" }) else { return false }
        return last.role == "assistant"
    }

    private func setGenerating(_ conversationId: String, _ on: Bool) {
        var next = generatingIds
        if on { next.insert(conversationId) } else { next.remove(conversationId) }
        generatingIds = next
    }

    private func patchSession(_ conversationId: String, status: String, preview: String) {
        guard let index = sessions.firstIndex(where: { $0.id == conversationId }) else { return }
        sessions[index] = sessions[index].patching(
            status: status,
            preview: preview,
            updatedAt: Date().timeIntervalSince1970 * 1000
        )
    }

    private func upsert(_ session: RemoteSession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }

    /// Brief background window: surface the event on the lock screen too.
    private func postLocalNotification(_ item: RemoteNotificationItem) {
        guard UIApplication.shared.applicationState != .active else { return }
        let content = UNMutableNotificationContent()
        content.title = "\(item.kindLabel) · \(item.title)"
        content.body = item.body
        content.sound = .default
        content.userInfo = ["conversationId": item.conversationId]
        content.threadIdentifier = item.conversationId
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: item.id, content: content, trigger: nil)
        )
    }

    private func scheduleReconnect() {
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self, self.generation == gen else { return }
            guard UIApplication.shared.applicationState == .active else { return }
            if case .disconnected = self.state { self.connect() }
        }
    }

    /// Keep optimistic local sends that the snapshot has not caught up with yet.
    private func mergeThread(
        server: [RemoteThreadMessage],
        local: [RemoteThreadMessage]
    ) -> [RemoteThreadMessage] {
        var rows = server
        let seen = Set(server.filter { $0.role == "user" }.map(\.text))
        for message in local where message.id.hasPrefix("local-") && !seen.contains(message.text) {
            rows.append(message)
        }
        return rows
    }

    private static func describeLinkError(_ error: NSError?) -> String {
        let raw = error?.localizedDescription ?? ""
        let lower = raw.lowercased()
        if raw.contains("中继") || raw.contains("连不上") { return raw }
        if lower.contains("timed out") || lower.contains("deadline") || lower.contains("timeout") {
            return "中继超时。离开 Wi‑Fi 后要经公网中继才能连电脑，正在重试。"
        }
        if lower.contains("meow") || lower.contains("derp") || lower.contains("canceled") {
            return "连不上中继。请确认电脑开着、VAV 在跑，然后点重试。"
        }
        if raw.isEmpty { return "无法连接到 Mac" }
        return raw
    }

    private func failSend(_ conversationId: String, _ message: String) {
        sendErrorConversationId = conversationId
        sendError = message
    }

    private func abandonCreateIfNeeded() {
        guard creating else { return }
        createGeneration += 1
        creating = false
        notice = "连接已断开。请重启电脑上的 VAV 后再点 +。"
    }

    func clearSendError() {
        sendError = nil
        sendErrorConversationId = nil
    }

    private func write(_ line: String) {
        guard let session else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            try? session.writeLine(line)
        }
    }

    private func teardown() {
        generation += 1
        if let session {
            self.session = nil
            // close() unblocks the read thread's pending readLine.
            DispatchQueue.global().async { session.close() }
        }
    }
}
