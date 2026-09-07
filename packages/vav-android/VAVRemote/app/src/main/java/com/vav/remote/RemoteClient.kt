package com.vav.remote

import android.content.Context
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Same phone-protocol client as iOS `RemoteClient`. Hello omits `role`;
 * vavd treats a non-daemon hello as the control plane.
 */
class RemoteClient(
    private val scope: CoroutineScope,
    private val store: PairingStore? = null,
    private val appContext: Context? = null
) {
    enum class State { Unpaired, Disconnected, Connecting, Connected }
    enum class SessionsLoad { Unknown, Loading, Ready, Unavailable, Offline }

    private val _state = MutableStateFlow(State.Unpaired)
    val state: StateFlow<State> = _state
    private val _sessionsLoad = MutableStateFlow(SessionsLoad.Unknown)
    val sessionsLoad: StateFlow<SessionsLoad> = _sessionsLoad
    private val _threadLoad = MutableStateFlow<Map<String, SessionsLoad>>(emptyMap())
    val threadLoad: StateFlow<Map<String, SessionsLoad>> = _threadLoad
    private val _tab = MutableStateFlow(RemoteTab.Sessions)
    val tab: StateFlow<RemoteTab> = _tab
    private val _sessions = MutableStateFlow<List<RemoteSession>>(emptyList())
    val sessions: StateFlow<List<RemoteSession>> = _sessions
    private val _threads = MutableStateFlow<Map<String, List<RemoteThreadMessage>>>(emptyMap())
    val threads: StateFlow<Map<String, List<RemoteThreadMessage>>> = _threads
    private val _controls = MutableStateFlow<Map<String, RemoteSessionControls>>(emptyMap())
    val controls: StateFlow<Map<String, RemoteSessionControls>> = _controls
    private val _drafts = MutableStateFlow<Map<String, String>>(emptyMap())
    val drafts: StateFlow<Map<String, String>> = _drafts
    private val _thinking = MutableStateFlow<Map<String, String>>(emptyMap())
    val thinking: StateFlow<Map<String, String>> = _thinking
    private val _awaiting = MutableStateFlow<Map<String, RemoteThreadBlock>>(emptyMap())
    val awaiting: StateFlow<Map<String, RemoteThreadBlock>> = _awaiting
    private val _liveBlocks = MutableStateFlow<Map<String, List<RemoteThreadBlock>>>(emptyMap())
    val liveBlocks: StateFlow<Map<String, List<RemoteThreadBlock>>> = _liveBlocks
    private val _recoveries = MutableStateFlow<Map<String, RemoteTurnRecovery>>(emptyMap())
    val recoveries: StateFlow<Map<String, RemoteTurnRecovery>> = _recoveries
    private val _dirs = MutableStateFlow<Map<String, RemoteDirs>>(emptyMap())
    val dirs: StateFlow<Map<String, RemoteDirs>> = _dirs
    private val _notifications = MutableStateFlow<List<RemoteNotificationItem>>(emptyList())
    val notifications: StateFlow<List<RemoteNotificationItem>> = _notifications
    private val _host = MutableStateFlow<RemoteHostSnapshot?>(null)
    val host: StateFlow<RemoteHostSnapshot?> = _host
    private val _pairings = MutableStateFlow<List<Pairing>>(emptyList())
    val pairings: StateFlow<List<Pairing>> = _pairings
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _openId = MutableStateFlow<String?>(null)
    val openId: StateFlow<String?> = _openId
    private val _lastSyncAt = MutableStateFlow<Long?>(null)
    val lastSyncAt: StateFlow<Long?> = _lastSyncAt
    private val _sendError = MutableStateFlow<String?>(null)
    val sendError: StateFlow<String?> = _sendError
    private val _sendErrorConversationId = MutableStateFlow<String?>(null)
    val sendErrorConversationId: StateFlow<String?> = _sendErrorConversationId
    private val _creating = MutableStateFlow(false)
    val creating: StateFlow<Boolean> = _creating
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice
    private val _generatingIds = MutableStateFlow<Set<String>>(emptySet())
    val generatingIds: StateFlow<Set<String>> = _generatingIds
    private val _reviews = MutableStateFlow<Map<String, RemoteReviewSet>>(emptyMap())
    val reviews: StateFlow<Map<String, RemoteReviewSet>> = _reviews
    private val requestedReviews = mutableSetOf<String>()

    private var pairing: Pairing? = null
    private var session: LineSession? = null
    private var reader: Job? = null
    private var reconnectJob: Job? = null
    private var viewingConversationId: String? = null
    private var generation = 0
    private var createGeneration = 0
    private var sessionsEpoch = 0
    private var foreground = true
    private val pendingThreads = mutableSetOf<String>()

    val isSyncing: Boolean
        get() = _sessionsLoad.value == SessionsLoad.Loading ||
            _threadLoad.value.values.any { it == SessionsLoad.Loading }

    fun isGenerating(conversationId: String): Boolean = conversationId in _generatingIds.value

    fun setForeground(on: Boolean) {
        foreground = on
    }

    fun clearNotice() {
        _notice.value = null
    }

    init {
        val book = store?.load() ?: PairingBook()
        _pairings.value = book.pairings
        pairing = book.active
        DiagLog.line(
            "client init paired=${book.pairings.size} active=${pairing?.displayName ?: "none"} token=${DiagLog.tokenHint(pairing?.token.orEmpty())}"
        )
        if (pairing != null) connect()
    }

    fun selectTab(next: RemoteTab) {
        _tab.value = next
    }

    fun pair(text: String): Boolean {
        val parsed = parseDaemonPairing(text) ?: return false
        val book = (store?.load() ?: PairingBook()).upsert(parsed)
        store?.save(book)
        _pairings.value = book.pairings
        pairing = parsed
        connect()
        return true
    }

    fun activate(next: Pairing) {
        val book = (store?.load() ?: PairingBook()).activate(next.token)
        store?.save(book)
        pairing = next
        _pairings.value = book.pairings
        DiagLog.line("adopt host=${next.displayName} token=${DiagLog.tokenHint(next.token)}")
        connect()
    }

    fun forget(next: Pairing) {
        val book = (store?.load() ?: PairingBook()).forget(next.token)
        store?.save(book)
        _pairings.value = book.pairings
        if (pairing?.token == next.token) {
            pairing = book.active
            if (pairing == null) {
                disconnect()
                _state.value = State.Unpaired
                _sessionsLoad.value = SessionsLoad.Unknown
            } else {
                connect()
            }
        }
    }

    fun isActive(row: Pairing): Boolean = pairing?.token == row.token

    fun connectIfNeeded() {
        if (pairing == null) return
        DiagLog.line("connectIfNeeded state=${_state.value.name}")
        if (_state.value == State.Connected || _state.value == State.Connecting) return
        connect()
    }

    /** Call on scene background: the socket dies there anyway. */
    fun suspend() {
        DiagLog.line("suspend")
        teardown(scheduleRetry = false)
        if (pairing != null) _state.value = State.Disconnected
    }

    fun connect() {
        val target = pairing ?: return
        teardown(scheduleRetry = false)
        _error.value = null
        _sendError.value = null
        _sendErrorConversationId.value = null
        DiagLog.line("connect host=${target.displayName} token=${DiagLog.tokenHint(target.token)}")
        val tunnelToken = target.remoteToken?.takeIf { it.startsWith("tc") }
        if (tunnelToken != null && TcmobileSessions.available()) {
            _state.value = State.Connecting
            _sessionsLoad.value = SessionsLoad.Loading
            reader = scope.launch(Dispatchers.IO) {
                try {
                    DiagLog.ingestGo()
                    val session = TcmobileSessions.dial(tunnelToken)
                    DiagLog.line("dial ok, sending hello")
                    runSession(session, target.secret)
                } catch (err: Exception) {
                    DiagLog.ingestGo()
                    DiagLog.line("dial fail raw=${err.message}")
                    if (target.hasLan) connectLan(target)
                    else {
                        _error.value = err.message ?: "无法通过公网中继连接电脑"
                        _state.value = State.Disconnected
                        scheduleReconnect()
                    }
                }
            }
            return
        }
        if (tunnelToken != null && !TcmobileSessions.available()) {
            DiagLog.line("dial fail tailcat aar missing")
        }
        if (tunnelToken != null && !target.hasLan) {
            _error.value =
                "此二维码走公网中继。运行 node scripts/build-tailcat-android.mjs 后重试，或粘贴 vavrtp:// 局域网配对。"
            _state.value = State.Disconnected
            return
        }
        if (!target.hasLan) {
            _error.value = "配对串缺少主机地址"
            _state.value = State.Disconnected
            return
        }
        connectLan(target)
    }

    private fun connectLan(target: Pairing) {
        _state.value = State.Connecting
        _sessionsLoad.value = SessionsLoad.Loading
        reader = scope.launch(Dispatchers.IO) {
            val line = TcpLineSession(target.host, target.port)
            try {
                line.connect()
                DiagLog.line("dial ok, sending hello")
                runSession(line, target.secret)
            } catch (err: Exception) {
                DiagLog.line("dial fail raw=${err.message}")
                _error.value = err.message
                _state.value = State.Disconnected
                scheduleReconnect()
            }
        }
    }

    private fun runSession(line: LineSession, secret: String) {
        val gen = generation
        session = line
        try {
            try {
                line.send(
                    encodeLine(
                        "hello",
                        mapOf(
                            "proto" to RemoteProto.VERSION,
                            "auth" to secret,
                            "device" to "VAV Remote"
                        )
                    )
                )
            } catch (err: Exception) {
                DiagLog.line("hello write fail ${err.message}")
                throw err
            }
            DiagLog.line("connected host=${pairing?.displayName ?: "VAV"}, waiting for sessions")
            line.readLines { raw -> if (generation == gen) ingest(raw) }
            DiagLog.ingestGo()
            DiagLog.line("read loop end eof")
            if (generation == gen && _state.value == State.Connected) {
                abandonCreateIfNeeded()
                _state.value = State.Disconnected
                scheduleReconnect()
            }
        } finally {
            line.close()
        }
    }

    fun createSession() {
        if (_creating.value || _state.value != State.Connected) return
        _creating.value = true
        createGeneration += 1
        val gen = createGeneration
        _sendError.value = null
        _sendErrorConversationId.value = null
        write(encodeLine("create"))
        scope.launch {
            delay(5_000)
            if (createGeneration != gen || !_creating.value) return@launch
            _creating.value = false
            _notice.value = "这台电脑上的 VAV 还不能从手机新建会话。请升级并重启桌面端。"
        }
    }

    fun send(conversationId: String, text: String, images: List<RemoteSendImage> = emptyList()) {
        val extra = mutableMapOf<String, Any?>(
            "conversationId" to conversationId,
            "text" to text
        )
        if (images.isNotEmpty()) {
            extra["images"] = JSONArray().apply {
                for (image in images.take(4)) {
                    put(
                        JSONObject()
                            .put("name", image.name)
                            .put("mime", image.mime)
                            .put("data", image.data)
                    )
                }
            }
        }
        write(encodeLine("send", extra))
        val caption = text.trim()
        val body = if (caption.isEmpty() && images.isNotEmpty()) "（附件）" else caption
        if (body.isNotEmpty()) {
            val local = RemoteThreadMessage(
                id = "local-${UUID.randomUUID()}",
                role = "user",
                text = body,
                at = System.currentTimeMillis().toDouble()
            )
            val rows = (_threads.value[conversationId] ?: emptyList()) + local
            _threads.value = _threads.value + (conversationId to rows)
            _threadLoad.value = _threadLoad.value + (conversationId to SessionsLoad.Ready)
        }
        setGenerating(conversationId, true)
        patchSession(conversationId, status = "running", preview = body.ifBlank { "Generating…" })
    }

    fun setViewingConversation(id: String?, ifCurrent: String? = null) {
        if (ifCurrent != null && viewingConversationId != ifCurrent) return
        viewingConversationId = id
    }

    fun clearSendError() {
        _sendError.value = null
        _sendErrorConversationId.value = null
    }

    private fun failSend(conversationId: String, message: String) {
        _sendErrorConversationId.value = conversationId
        _sendError.value = message
    }

    fun requestThread(conversationId: String) {
        if (_state.value != State.Connected) {
            if (_threadLoad.value[conversationId] != SessionsLoad.Ready) {
                _threadLoad.value = _threadLoad.value + (conversationId to SessionsLoad.Offline)
            }
            return
        }
        if (_threadLoad.value[conversationId] != SessionsLoad.Ready) {
            _threadLoad.value = _threadLoad.value + (conversationId to SessionsLoad.Loading)
        }
        if (!pendingThreads.add(conversationId)) return
        DiagLog.line("request thread ${conversationId.take(8)}")
        write(encodeLine("thread", mapOf("conversationId" to conversationId)))
        val gen = generation
        scope.launch {
            delay(20_000)
            if (generation != gen || !pendingThreads.remove(conversationId)) return@launch
            if (_threadLoad.value[conversationId] == SessionsLoad.Loading) {
                DiagLog.line("thread timeout ${conversationId.take(8)}")
                _threadLoad.value = _threadLoad.value + (conversationId to SessionsLoad.Unavailable)
                if (_threads.value[conversationId] == null) {
                    _threads.value = _threads.value + (conversationId to emptyList())
                }
            }
        }
    }

    fun requestControls(conversationId: String) = write(encodeLine("controls", mapOf("conversationId" to conversationId)))

    fun requestSessions() {
        DiagLog.line("request sessions")
        if (_state.value == State.Connected) _sessionsLoad.value = SessionsLoad.Loading
        write(encodeLine("sessions"))
    }

    suspend fun refreshSessionsAndWait() {
        val before = sessionsEpoch
        requestSessions()
        repeat(160) {
            if (sessionsEpoch != before) return
            delay(120)
        }
    }

    fun configure(
        conversationId: String,
        model: String? = null,
        approvalMode: String? = null,
        thinkingLevel: String? = null,
        mode: String? = null,
        agent: String? = null,
        fast: Boolean? = null
    ) {
        write(
            encodeLine(
                "configure",
                mapOf(
                    "conversationId" to conversationId,
                    "model" to model,
                    "approvalMode" to approvalMode,
                    "thinkingLevel" to thinkingLevel,
                    "mode" to mode,
                    "agent" to agent,
                    "fast" to fast
                )
            )
        )
    }

    fun reply(conversationId: String, toolCallId: String, answer: String) {
        write(encodeLine("reply", mapOf("conversationId" to conversationId, "toolCallId" to toolCallId, "answer" to answer)))
        _awaiting.value = _awaiting.value - conversationId
        setGenerating(conversationId, true)
    }

    fun cancel(conversationId: String) {
        write(encodeLine("cancel", mapOf("conversationId" to conversationId)))
        setGenerating(conversationId, false)
        _drafts.value = _drafts.value - conversationId
        _thinking.value = _thinking.value - conversationId
        _liveBlocks.value = _liveBlocks.value - conversationId
        _awaiting.value = _awaiting.value - conversationId
        _recoveries.value = _recoveries.value - conversationId
    }

    fun rename(conversationId: String, title: String) {
        write(encodeLine("rename", mapOf("conversationId" to conversationId, "title" to title)))
    }

    fun archive(conversationId: String) = write(encodeLine("archive", mapOf("conversationId" to conversationId)))

    fun setPinned(conversationId: String, pinned: Boolean) {
        write(encodeLine("pin", mapOf("conversationId" to conversationId, "pinned" to pinned)))
    }

    fun setFavorite(conversationId: String, favorite: Boolean) {
        write(encodeLine("favorite", mapOf("conversationId" to conversationId, "favorite" to favorite)))
    }

    fun browse(conversationId: String, path: String? = null) {
        write(encodeLine("browse", mapOf("conversationId" to conversationId, "path" to path)))
    }

    fun workspace(conversationId: String, path: String? = null, temp: Boolean = false) {
        write(encodeLine("workspace", mapOf("conversationId" to conversationId, "path" to path, "temp" to if (temp) true else null)))
    }

    fun compact(conversationId: String) = write(encodeLine("compact", mapOf("conversationId" to conversationId)))

    fun regenerate(conversationId: String, messageId: String) =
        write(encodeLine("regenerate", mapOf("conversationId" to conversationId, "messageId" to messageId)))

    fun edit(conversationId: String, messageId: String, text: String) =
        write(encodeLine("edit", mapOf("conversationId" to conversationId, "messageId" to messageId, "text" to text)))

    fun fork(conversationId: String, messageId: String) =
        write(encodeLine("fork", mapOf("conversationId" to conversationId, "messageId" to messageId)))

    fun duplicate(conversationId: String) = write(encodeLine("duplicate", mapOf("conversationId" to conversationId)))

    fun continueInNew(conversationId: String, messageId: String) =
        write(encodeLine("continue", mapOf("conversationId" to conversationId, "messageId" to messageId)))

    fun applyGoal(conversationId: String, action: String, objective: String? = null) =
        write(encodeLine("goal", mapOf("conversationId" to conversationId, "action" to action, "objective" to objective)))

    fun review(conversationId: String, action: String, setId: String? = null) =
        write(encodeLine("review", mapOf("conversationId" to conversationId, "action" to action, "setId" to setId)))

    private fun requestMissingReviews(conversationId: String, messages: List<RemoteThreadMessage>) {
        for (message in messages) {
            val setId = message.changeSetId ?: continue
            if (setId.isBlank() || _reviews.value.containsKey(setId) || setId in requestedReviews) continue
            requestedReviews.add(setId)
            review(conversationId, "get", setId)
        }
    }

    private fun parseReviewSet(obj: JSONObject): RemoteReviewSet? {
        val id = obj.optString("id")
        if (id.isBlank()) return null
        val files = obj.optJSONArray("files")
        return RemoteReviewSet(
            id = id,
            status = obj.optString("status", "pending"),
            files = buildList {
                if (files == null) return@buildList
                for (i in 0 until files.length()) {
                    val row = files.optJSONObject(i) ?: continue
                    val name = row.optString("name")
                    if (name.isBlank()) continue
                    add(RemoteReviewFile(name, row.optString("status", "pending")))
                }
            }
        )
    }

    fun locateWorkspace(conversationId: String, destinationDir: String) =
        write(encodeLine("locate", mapOf("conversationId" to conversationId, "destinationDir" to destinationDir)))

    fun deleteMessage(conversationId: String, messageId: String) =
        write(encodeLine("delete-message", mapOf("conversationId" to conversationId, "messageId" to messageId)))

    fun setLeaf(conversationId: String, messageId: String) =
        write(encodeLine("leaf", mapOf("conversationId" to conversationId, "messageId" to messageId)))

    fun openConversation(id: String) {
        _tab.value = RemoteTab.Sessions
        _openId.value = id
        requestThread(id)
        requestControls(id)
    }

    fun openFromNotification(item: RemoteNotificationItem) {
        openConversation(item.conversationId)
        _notifications.value = _notifications.value.filter { it.conversationId != item.conversationId }
    }

    fun clearOpenRequest() {
        _openId.value = null
    }

    fun dismissNotification(item: RemoteNotificationItem) {
        _notifications.value = _notifications.value.filter { it.id != item.id }
    }

    fun disconnect() {
        teardown(scheduleRetry = false)
        if (_state.value != State.Unpaired) _state.value = State.Disconnected
    }

    private fun teardown(scheduleRetry: Boolean) {
        generation += 1
        reconnectJob?.cancel()
        reconnectJob = null
        reader?.cancel()
        reader = null
        session?.close()
        session = null
        if (_sessionsLoad.value == SessionsLoad.Loading) _sessionsLoad.value = SessionsLoad.Unknown
        if (scheduleRetry) scheduleReconnect()
    }

    private fun scheduleReconnect() {
        val gen = generation
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(4_000)
            if (generation != gen || !foreground) return@launch
            if (_state.value == State.Disconnected) connect()
        }
    }

    private fun write(line: String) {
        scope.launch(Dispatchers.IO) {
            try {
                session?.send(line)
            } catch (err: Exception) {
                _error.value = err.message
            }
        }
    }

    private fun ingest(raw: String) {
        val obj =
            try {
                JSONObject(raw)
            } catch (_: Exception) {
                DiagLog.line("skip frame bytes=${raw.length} head=${raw.take(40)}")
                return
            }
        when (obj.optString("type")) {
            "welcome" -> {
                _state.value = State.Connected
                _lastSyncAt.value = System.currentTimeMillis()
                DiagLog.line("welcome ${obj.optString("app")} ${obj.optString("version")}")
                viewingConversationId?.let {
                    requestThread(it)
                    requestControls(it)
                }
            }
            "host" -> {
                val snapshot = parseHost(obj)
                _host.value = snapshot
                rememberActiveName(snapshot.name)
                _lastSyncAt.value = System.currentTimeMillis()
                DiagLog.line("host ${obj.optString("name")}")
            }
            "sessions" -> {
                val next = parseSessions(obj.optJSONArray("sessions"))
                _sessions.value = sortedRemoteSessions(next)
                sessionsEpoch += 1
                _sessionsLoad.value = SessionsLoad.Ready
                _lastSyncAt.value = System.currentTimeMillis()
                DiagLog.line("sessions n=${next.size}")
                finishTurnsIfIdle(next)
            }
            "thread" -> {
                val id = obj.optString("conversationId")
                pendingThreads.remove(id)
                val messages = mergeThread(parseMessages(obj.optJSONArray("messages")), _threads.value[id] ?: emptyList())
                _threads.value = _threads.value + (id to messages)
                _threadLoad.value = _threadLoad.value + (id to SessionsLoad.Ready)
                _lastSyncAt.value = System.currentTimeMillis()
                DiagLog.line("thread ${id.take(8)} n=${messages.size}")
                if (threadShowsCompletedTurn(messages)) {
                    setGenerating(id, false)
                    _drafts.value = _drafts.value - id
                    _thinking.value = _thinking.value - id
                    _liveBlocks.value = _liveBlocks.value - id
                }
                val waiting = lastAwaiting(messages)
                if (waiting != null) {
                    _awaiting.value = _awaiting.value + (id to waiting)
                } else if (!isGenerating(id)) {
                    _awaiting.value = _awaiting.value - id
                }
                requestMissingReviews(id, messages)
            }
            "reviewed" -> {
                val set = obj.optJSONObject("set")?.let { parseReviewSet(it) }
                if (obj.optBoolean("ok") && set != null) {
                    _reviews.value = _reviews.value + (set.id to set)
                    requestedReviews.remove(set.id)
                }
            }
            "controls" -> {
                val row = parseControls(obj) ?: return
                _controls.value = _controls.value + (row.conversationId to row)
            }
            "turn" -> {
                val id = obj.optString("conversationId")
                val draft = obj.optString("draft")
                if (draft.isNotBlank()) _drafts.value = _drafts.value + (id to draft)
                val thinking = obj.optString("thinking")
                if (thinking.isNotBlank()) _thinking.value = _thinking.value + (id to thinking)
                val blocks = parseThreadBlocks(obj.optJSONArray("blocks"))
                if (blocks.isNotEmpty()) _liveBlocks.value = _liveBlocks.value + (id to blocks)
                val waiting = obj.optJSONObject("awaiting")
                if (waiting != null && waiting.optString("kind") == "awaiting") {
                    _awaiting.value = _awaiting.value + (id to parseThreadBlock(waiting))
                }
                val recoveryObj = obj.optJSONObject("recovery")
                if (recoveryObj != null) {
                    val recoveryKind = recoveryObj.optString("kind")
                    if (recoveryKind == "healing" || recoveryKind == "retrying" || recoveryKind == "reconnecting") {
                        _recoveries.value = _recoveries.value + (id to RemoteTurnRecovery(
                            kind = recoveryKind,
                            attempt = recoveryObj.optInt("attempt", 1),
                            limit = recoveryObj.optInt("limit", 1)
                        ))
                    }
                } else if (obj.optString("phase") == "running") {
                    _recoveries.value = _recoveries.value - id
                }
                val phase = obj.optString("phase")
                if (phase == "running") {
                    setGenerating(id, true)
                    if (waiting == null) _awaiting.value = _awaiting.value - id
                    patchSession(id, status = "running", preview = draft.ifBlank { "Generating…" })
                } else if (phase == "awaiting") {
                    setGenerating(id, false)
                    patchSession(id, status = "running", preview = "等待回复…")
                } else if (phase in setOf("done", "error", "cancelled")) {
                    setGenerating(id, false)
                    _awaiting.value = _awaiting.value - id
                    _recoveries.value = _recoveries.value - id
                    // Keep thinking + draft until the sealed `thread` arrives.
                    if (phase == "error") {
                        val turnError = obj.optString("error")
                        if (turnError.isNotBlank()) failSend(id, turnError)
                    }
                }
            }
            "dirs" -> {
                val dirs = parseDirs(obj) ?: return
                _dirs.value = _dirs.value + (dirs.conversationId to dirs)
            }
            "notification" -> {
                val item = RemoteNotificationItem(
                    kind = obj.optString("kind"),
                    conversationId = obj.optString("conversationId"),
                    title = obj.optString("title"),
                    body = obj.optString("body"),
                    at = obj.optDouble("at", 0.0)
                )
                _notifications.value = listOf(item) + _notifications.value.take(199)
                if (item.kind == "turn-complete") applyTurnFinished(item.conversationId)
                appContext?.let { RemoteNotifier.post(it, item) }
            }
            "created" -> {
                createGeneration += 1
                _creating.value = false
                val row = obj.optJSONObject("session") ?: return
                val next = parseSession(row)
                _sessions.value = sortedRemoteSessions(listOf(next) + _sessions.value.filter { it.id != next.id })
                openConversation(next.id)
            }
            "error" -> {
                val code = obj.optString("code")
                val message = obj.optString("message")
                val conversationId = obj.optString("conversationId")
                if (_creating.value) {
                    createGeneration += 1
                    _creating.value = false
                    _notice.value = if (message.contains("unrecognized") || code == "bad-request") {
                        "请先重启电脑上的 VAV，再从手机新建会话。"
                    } else {
                        message.ifBlank { code }
                    }
                    return
                }
                if (code == "auth") {
                    DiagLog.line("auth rejected")
                    disconnect()
                    _error.value = "配对被拒绝，请重新扫码"
                    _state.value = State.Disconnected
                } else if (code == "bad-request" && message.contains("unrecognized")) {
                    // Protocol / unknown-frame noise must never surface as 发送失败.
                } else if (conversationId.isNotBlank()) {
                    pendingThreads.remove(conversationId)
                    setGenerating(conversationId, false)
                    if (_threadLoad.value[conversationId] == SessionsLoad.Loading) {
                        _threadLoad.value = _threadLoad.value + (conversationId to SessionsLoad.Ready)
                        if (_threads.value[conversationId] == null) {
                            _threads.value = _threads.value + (conversationId to emptyList())
                        }
                    }
                    failSend(conversationId, message.ifBlank { code })
                } else {
                    _error.value = message
                }
            }
        }
    }

    private fun setGenerating(conversationId: String, on: Boolean) {
        _generatingIds.value = if (on) _generatingIds.value + conversationId else _generatingIds.value - conversationId
    }

    private fun patchSession(conversationId: String, status: String, preview: String) {
        _sessions.value = sortedRemoteSessions(
            _sessions.value.map { row ->
                if (row.id != conversationId) row
                else row.copy(status = status, preview = preview, updatedAt = System.currentTimeMillis().toDouble())
            }
        )
    }

    private fun applyTurnFinished(conversationId: String) {
        setGenerating(conversationId, false)
        _sessions.value = sortedRemoteSessions(
            _sessions.value.map { row ->
                if (row.id == conversationId && row.status == "running") row.copy(status = "done") else row
            }
        )
    }

    private fun finishTurnsIfIdle(sessions: List<RemoteSession>) {
        for (row in sessions) {
            if (row.status != "running" && row.id in _generatingIds.value) setGenerating(row.id, false)
        }
    }

    private fun threadShowsCompletedTurn(messages: List<RemoteThreadMessage>): Boolean {
        val last = messages.lastOrNull { it.role != "system" } ?: return false
        return last.role == "assistant"
    }

    private fun lastAwaiting(messages: List<RemoteThreadMessage>): RemoteThreadBlock? {
        for (message in messages.asReversed()) {
            val block = message.blocks.lastOrNull { it.kind == "awaiting" }
            if (block != null) return block
        }
        return null
    }

    private fun mergeThread(
        server: List<RemoteThreadMessage>,
        local: List<RemoteThreadMessage>
    ): List<RemoteThreadMessage> {
        val seen = server.filter { it.role == "user" }.map { it.text }.toSet()
        return server + local.filter { it.id.startsWith("local-") && it.text !in seen }
    }

    private fun rememberActiveName(name: String) {
        val trimmed = name.trim()
        val current = pairing ?: return
        if (trimmed.isEmpty() || current.name == trimmed) return
        val renamed = current.copy(name = trimmed)
        pairing = renamed
        val book = (store?.load() ?: PairingBook()).upsert(renamed)
        store?.save(book)
        _pairings.value = book.pairings
    }

    private fun abandonCreateIfNeeded() {
        if (!_creating.value) return
        createGeneration += 1
        _creating.value = false
        _notice.value = "连接已断开。请重启电脑上的 VAV 后再点 +。"
    }

    private fun parseSessions(array: JSONArray?): List<RemoteSession> {
        if (array == null) return emptyList()
        return buildList {
            for (i in 0 until array.length()) add(parseSession(array.getJSONObject(i)))
        }
    }

    private fun parseMessages(array: JSONArray?): List<RemoteThreadMessage> {
        if (array == null) return emptyList()
        return buildList {
            for (i in 0 until array.length()) {
                val row = array.optJSONObject(i) ?: continue
                add(
                    RemoteThreadMessage(
                        id = row.optString("id"),
                        role = row.optString("role", "assistant"),
                        text = row.optString("text"),
                        at = row.optDouble("at", 0.0),
                        cancelled = row.optBoolean("cancelled"),
                        error = row.optString("error").ifBlank { null },
                        blocks = parseThreadBlocks(row.optJSONArray("blocks")),
                        changeSetId = row.optString("changeSetId").ifBlank { null }
                    )
                )
            }
        }
    }

    private fun parseControls(obj: JSONObject): RemoteSessionControls? {
        val id = obj.optString("conversationId")
        if (id.isBlank()) return null
        return RemoteSessionControls(
            conversationId = id,
            agentLocked = obj.optBoolean("agentLocked"),
            agent = obj.optString("agent", "vav"),
            agents = jsonChoices(obj.optJSONArray("agents")),
            model = obj.optString("model"),
            models = jsonChoices(obj.optJSONArray("models")),
            thinking = obj.optString("thinking").ifBlank { null },
            thinkingLevels = jsonChoices(obj.optJSONArray("thinkingLevels")),
            mode = obj.optString("mode").ifBlank { null },
            modes = jsonChoices(obj.optJSONArray("modes")),
            approval = obj.optString("approval", "auto"),
            approvals = jsonChoices(obj.optJSONArray("approvals")),
            fast = if (obj.has("fast") && !obj.isNull("fast")) obj.optBoolean("fast") else null,
            workingDirectory = obj.optString("workingDirectory"),
            dirLabel = obj.optString("dirLabel"),
            temporary = obj.optBoolean("temporary")
        )
    }

    private fun parseDirs(obj: JSONObject): RemoteDirs? {
        val id = obj.optString("conversationId")
        if (id.isBlank()) return null
        val entries = obj.optJSONArray("entries")
        return RemoteDirs(
            conversationId = id,
            path = obj.optString("path"),
            parent = obj.optString("parent").ifBlank { null },
            entries = buildList {
                if (entries == null) return@buildList
                for (i in 0 until entries.length()) {
                    val row = entries.optJSONObject(i) ?: continue
                    add(RemoteDirEntry(row.optString("name"), row.optString("path")))
                }
            }
        )
    }

    private fun parseHost(obj: JSONObject): RemoteHostSnapshot {
        val caps = obj.optJSONObject("capabilities")
        val defaults = obj.optJSONObject("defaults")
        val recents = obj.optJSONArray("recentDirs")
        return RemoteHostSnapshot(
            name = obj.optString("name", "VAV"),
            platform = obj.optString("platform").ifBlank { null },
            hasKey = obj.optBoolean("hasKey"),
            capabilities = RemoteCapabilities(
                cancel = caps?.optBoolean("cancel") == true,
                reply = caps?.optBoolean("reply") == true,
                rename = caps?.optBoolean("rename") == true,
                archive = caps?.optBoolean("archive") == true,
                pin = caps?.optBoolean("pin") == true,
                favorite = caps?.optBoolean("favorite") == true,
                workdirPick = caps?.optBoolean("workdirPick") == true,
                attachments = caps?.optBoolean("attachments") == true,
                pty = caps?.optBoolean("pty") == true,
                spawn = caps?.optBoolean("spawn") == true,
                fsRead = caps?.optBoolean("fsRead") == true,
                keys = caps?.optBoolean("keys") == true
            ),
            defaults = HostDefaults(
                agent = defaults?.optString("agent", "vav") ?: "vav",
                model = defaults?.optString("model").orEmpty(),
                thinking = defaults?.optString("thinking")?.ifBlank { null },
                approval = defaults?.optString("approval", "auto") ?: "auto"
            ),
            recentDirs = buildList {
                if (recents == null) return@buildList
                for (i in 0 until recents.length()) {
                    val row = recents.optJSONObject(i) ?: continue
                    add(RecentDir(row.optString("path"), row.optString("label")))
                }
            }
        )
    }
}
