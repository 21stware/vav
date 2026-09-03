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

    enum SessionsLoad: Equatable {
        case unknown
        case loading
        case ready
    }

    @Published var selectedTab: RemoteTab = .sessions
    @Published private(set) var state: State = .unpaired
    @Published private(set) var sessions: [RemoteSession] = []
    @Published private(set) var sessionsLoad: SessionsLoad = .unknown
    @Published private(set) var lastSyncAt: Date?
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
    @Published private(set) var pairings: [Pairing] = []
    @Published private(set) var activeToken: String?

    private var pairing: Pairing?
    private var session: TcmobileSession?
    private let writeQueue = DispatchQueue(label: "vav.remote.write")
    /// Bumped on every disconnect; stale dial results / read loops bail out.
    private var generation = 0
    private var createGeneration = 0
    private var pendingThreads = Set<String>()
    private var sessionsEpoch = 0
    /// Conversation currently on screen. Reconnect / turn-complete only refresh this one.
    private var viewingConversationId: String?

    var isSyncing: Bool {
        sessionsLoad == .loading || threadLoad.values.contains(.loading)
    }

    override init() {
        let book = PairingStore.loadBook()
        pairings = book.pairings
        pairing = book.active
        activeToken = book.active?.token
        super.init()
        if pairing != nil { state = .disconnected(nil) }
        UNUserNotificationCenter.current().delegate = self
        DiagLog.line(
            "client init paired=\(pairings.count) active=\(pairing?.displayName ?? "none") token=\(DiagLog.tokenHint(pairing?.token ?? ""))"
        )
    }

    var isPaired: Bool { !pairings.isEmpty }
    var pairedHost: String { pairing?.displayName ?? "电脑" }

    private var stateLabel: String {
        switch state {
        case .connected(let host): return "connected(\(host))"
        case .connecting: return "connecting"
        case .disconnected(let error): return "disconnected(\(error ?? "nil"))"
        case .unpaired: return "unpaired"
        }
    }

    func isGenerating(_ conversationId: String) -> Bool {
        generatingIds.contains(conversationId)
    }

    func isActive(_ pairing: Pairing) -> Bool {
        pairing.token == activeToken
    }

    /// Scan a QR: add a new computer, or refresh an existing one, then connect.
    func adopt(pairing next: Pairing) {
        DiagLog.line("adopt host=\(next.displayName) token=\(DiagLog.tokenHint(next.token))")
        upsert(next, activate: true)
        switchToActive()
    }

    func activate(_ pairing: Pairing) {
        guard pairings.contains(where: { $0.token == pairing.token }) else { return }
        if activeToken == pairing.token {
            connectIfNeeded()
            return
        }
        self.pairing = pairing
        activeToken = pairing.token
        persistBook()
        switchToActive()
    }

    func forget(_ pairing: Pairing) {
        pairings.removeAll { $0.token == pairing.token }
        if activeToken == pairing.token {
            self.pairing = pairings.first
            activeToken = self.pairing?.token
            persistBook()
            switchToActive()
            return
        }
        persistBook()
    }

    func unpair() {
        guard let pairing else {
            forgetAll()
            return
        }
        forget(pairing)
    }

    private func forgetAll() {
        PairingStore.clear()
        pairings = []
        pairing = nil
        activeToken = nil
        resetHostState()
        teardown()
        state = .unpaired
    }

    private func upsert(_ next: Pairing, activate: Bool) {
        if let index = pairings.firstIndex(where: { $0.token == next.token }) {
            var merged = next
            if (merged.host ?? "").isEmpty { merged.host = pairings[index].host }
            pairings[index] = merged
        } else {
            pairings.append(next)
        }
        if activate {
            pairing = pairings.first(where: { $0.token == next.token }) ?? next
            activeToken = pairing?.token
        }
        persistBook()
    }

    private func rememberActiveName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let token = activeToken,
              let index = pairings.firstIndex(where: { $0.token == token }),
              pairings[index].host != trimmed
        else { return }
        pairings[index] = pairings[index].renaming(trimmed)
        if pairing?.token == token { pairing = pairings[index] }
        if case .connected = state { state = .connected(host: trimmed) }
        persistBook()
    }

    private func persistBook() {
        if pairings.isEmpty {
            PairingStore.clear()
            return
        }
        PairingStore.save(PairingBook(pairings: pairings, activeToken: activeToken))
    }

    private func switchToActive() {
        resetHostState()
        teardown()
        if pairing != nil {
            connect()
        } else {
            state = .unpaired
        }
    }

    private func resetHostState() {
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
        sessionsLoad = .unknown
        lastSyncAt = nil
    }

    /// Call on launch and every scenePhase → .active transition.
    func connectIfNeeded() {
        guard pairing != nil else { return }
        switch state {
        case .connected, .connecting: return
        default:
            DiagLog.line("connectIfNeeded state=\(stateLabel)")
            connect()
        }
    }

    /// Call on scenePhase → .background: the socket dies there anyway.
    func suspend() {
        DiagLog.line("suspend")
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
        if case .connected = state { sessionsLoad = .loading }
        DiagLog.line("request sessions")
        write(line)
    }

    func refreshSessionsAndWait() async {
        let before = sessionsEpoch
        refreshSessions()
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline && !Task.isCancelled {
            if sessionsEpoch != before { return }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
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

    func setPinned(conversationId: String, pinned: Bool) {
        guard let line = ClientFrame.pin(conversationId: conversationId, pinned: pinned) else { return }
        write(line)
        if let index = sessions.firstIndex(where: { $0.id == conversationId }) {
            sessions[index] = sessions[index].patching(
                pinned: pinned,
                pinTime: pinned ? Date().timeIntervalSince1970 * 1000 : 0
            )
            sessions = sortedRemoteSessions(sessions)
        }
    }

    func setFavorite(conversationId: String, favorite: Bool) {
        guard let line = ClientFrame.favorite(conversationId: conversationId, favorite: favorite) else { return }
        write(line)
        if let index = sessions.firstIndex(where: { $0.id == conversationId }) {
            sessions[index] = sessions[index].patching(favorite: favorite)
        }
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

    func setViewingConversation(_ id: String?, ifCurrent: String? = nil) {
        if let ifCurrent, viewingConversationId != ifCurrent { return }
        viewingConversationId = id
    }

    func requestThread(conversationId: String) {
        guard case .connected = state else {
            if threadLoad[conversationId] != .ready {
                threadLoad[conversationId] = .offline
            }
            return
        }
        if threadLoad[conversationId] != .ready {
            threadLoad[conversationId] = .loading
        }
        if pendingThreads.contains(conversationId) { return }
        guard let line = ClientFrame.thread(conversationId: conversationId) else { return }
        pendingThreads.insert(conversationId)
        DiagLog.line("request thread \(conversationId.prefix(8))")
        write(line)
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.generation == gen else { return }
            guard self.pendingThreads.contains(conversationId) else { return }
            self.pendingThreads.remove(conversationId)
            if self.threadLoad[conversationId] == .loading {
                DiagLog.line("thread timeout \(conversationId.prefix(8))")
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
        DiagLog.line("connect host=\(pairing.displayName) token=\(DiagLog.tokenHint(pairing.token)) gen=\(gen)")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var dialError: NSError?
            let session = TcmobileDial(pairing.token, &dialError)
            DiagLog.ingestGo()
            guard let session else {
                let shown = Self.describeLinkError(dialError)
                DiagLog.line("dial fail raw=\(dialError?.localizedDescription ?? "nil") shown=\(shown)")
                DispatchQueue.main.async {
                    guard let self, self.generation == gen else { return }
                    self.state = .disconnected(shown)
                    self.scheduleReconnect()
                }
                return
            }
            DiagLog.line("dial ok, sending hello")
            do {
                guard let hello = ClientFrame.hello(secret: pairing.secret, device: device) else {
                    throw NSError(domain: "vav.remote", code: 1)
                }
                try session.writeLine(hello)
            } catch {
                DiagLog.line("hello write fail \(error.localizedDescription)")
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
                self.state = .connected(host: pairing.displayName)
                self.sessionsLoad = .loading
                DiagLog.line("connected host=\(pairing.displayName), waiting for sessions")
                self.startReadThread(session: session, generation: gen)
                // Hello already pushes the list. Only refresh the open transcript.
                if let viewing = self.viewingConversationId {
                    self.requestThread(conversationId: viewing)
                    self.requestControls(conversationId: viewing)
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
                    DiagLog.ingestGo()
                    DiagLog.line("read loop end \(error?.localizedDescription ?? "eof")")
                    DispatchQueue.main.async {
                        guard let self, self.generation == gen else { return }
                        self.session = nil
                        self.abandonCreateIfNeeded()
                        self.state = .disconnected(nil)
                        self.scheduleReconnect()
                    }
                    return
                }
                guard let frame = ServerFrame.parse(line) else {
                    DiagLog.line("skip frame bytes=\(line.utf8.count) head=\(line.prefix(40))")
                    continue
                }
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
        case .welcome(let app, let version):
            DiagLog.line("welcome \(app) \(version)")
        case .host(let snapshot):
            host = snapshot
            rememberActiveName(snapshot.name)
            DiagLog.line("host \(snapshot.name)")
        case .sessions(let sessions):
            self.sessions = sortedRemoteSessions(sessions)
            sessionsEpoch += 1
            sessionsLoad = .ready
            lastSyncAt = Date()
            DiagLog.line("sessions n=\(sessions.count)")
            finishTurnsIfIdle(in: sessions)
        case .thread(let conversationId, let messages):
            pendingThreads.remove(conversationId)
            threads[conversationId] = mergeThread(
                server: messages,
                local: threads[conversationId] ?? []
            )
            threadLoad[conversationId] = .ready
            lastSyncAt = Date()
            DiagLog.line("thread \(conversationId.prefix(8)) n=\(messages.count)")
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
                DiagLog.line("auth rejected")
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

    /// Turn finished: Mac already pushed `thread` + `sessions`. Don't refetch the pipe.
    private func applyTurnFinished(_ conversationId: String) {
        setGenerating(conversationId, false)
        if let index = sessions.firstIndex(where: { $0.id == conversationId }),
           sessions[index].status == "running" {
            sessions[index] = sessions[index].patching(status: "done")
        }
    }

    private func finishTurnsIfIdle(in sessions: [RemoteSession]) {
        for session in sessions where session.status != "running" && generatingIds.contains(session.id) {
            setGenerating(session.id, false)
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
        sessions = sortedRemoteSessions(sessions)
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
        writeQueue.async {
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
