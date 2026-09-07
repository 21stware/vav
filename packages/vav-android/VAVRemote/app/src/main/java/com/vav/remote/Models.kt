package com.vav.remote

import org.json.JSONArray
import org.json.JSONObject

/** Wire types mirroring `src/shared/remoteControl.ts` and iOS `Models.swift`. */
object RemoteProto {
    const val VERSION = 1
}

enum class RemoteTab { Sessions, Notifications, Settings }

data class RemoteTurnRecovery(
    val kind: String,
    val attempt: Int,
    val limit: Int
)

fun turnRecoveryLabel(kind: String): String = when (kind) {
    "retrying" -> "重试中"
    "reconnecting" -> "重连中"
    else -> "恢复中"
}

data class RemoteSessionGoal(
    val status: String,
    val objective: String,
    val lastReason: String? = null
) {
    val statusLabel: String
        get() = when (status) {
            "active" -> "进行中"
            "paused" -> "已暂停"
            "blocked" -> "受阻"
            "limited" -> "额度受限"
            "complete" -> "已完成"
            else -> status
        }
}

data class RemoteSession(
    val id: String,
    val title: String,
    val dirLabel: String,
    val status: String,
    val surface: String,
    val updatedAt: Double,
    val preview: String? = null,
    val workdir: String? = null,
    val temporary: Boolean = false,
    val pinned: Boolean = false,
    val pinTime: Double = 0.0,
    val favorite: Boolean = false,
    val goal: RemoteSessionGoal? = null
)

data class RemoteChoice(val id: String, val label: String)

data class RemoteSessionControls(
    val conversationId: String,
    val agentLocked: Boolean,
    val agent: String,
    val agents: List<RemoteChoice>,
    val model: String,
    val models: List<RemoteChoice>,
    val thinking: String?,
    val thinkingLevels: List<RemoteChoice>,
    val mode: String?,
    val modes: List<RemoteChoice>,
    val approval: String,
    val approvals: List<RemoteChoice>,
    val fast: Boolean?,
    val workingDirectory: String,
    val dirLabel: String,
    val temporary: Boolean
)

data class RemotePlanStep(val text: String, val done: Boolean = false)

data class RemoteThreadBlock(
    val kind: String,
    val text: String? = null,
    val id: String? = null,
    val tool: String? = null,
    val name: String? = null,
    val summary: String? = null,
    val status: String? = null,
    val title: String? = null,
    val prompt: String? = null,
    val steps: List<RemotePlanStep> = emptyList(),
    val choices: List<RemoteChoice> = emptyList(),
    val multiSelect: Boolean = false
)

data class RemoteReviewFile(val name: String, val status: String)

data class RemoteReviewSet(
    val id: String,
    val status: String,
    val files: List<RemoteReviewFile> = emptyList()
)

data class RemoteThreadMessage(
    val id: String,
    val role: String,
    val text: String,
    val at: Double,
    val cancelled: Boolean = false,
    val error: String? = null,
    val blocks: List<RemoteThreadBlock> = emptyList(),
    val changeSetId: String? = null
)

data class RemoteNotificationItem(
    val kind: String,
    val conversationId: String,
    val title: String,
    val body: String,
    val at: Double
) {
    val id: String get() = "$conversationId-$at"
    val kindLabel: String
        get() = when (kind) {
            "turn-complete" -> "完成"
            "ask" -> "提问"
            "approval" -> "待批准"
            "request" -> "请求"
            else -> kind
        }
}

data class RemoteDirEntry(val name: String, val path: String)

data class RemoteDirs(
    val conversationId: String,
    val path: String,
    val parent: String?,
    val entries: List<RemoteDirEntry>
)

data class RecentDir(val path: String, val label: String)

data class RemoteCapabilities(
    val cancel: Boolean = false,
    val reply: Boolean = false,
    val rename: Boolean = false,
    val archive: Boolean = false,
    val pin: Boolean = false,
    val favorite: Boolean = false,
    val workdirPick: Boolean = false,
    val attachments: Boolean = false,
    val pty: Boolean = false,
    val spawn: Boolean = false,
    val fsRead: Boolean = false,
    val keys: Boolean = false
)

data class HostDefaults(
    val agent: String = "vav",
    val model: String = "",
    val thinking: String? = null,
    val approval: String = "auto"
)

data class RemoteHostSnapshot(
    val name: String,
    val platform: String? = null,
    val hasKey: Boolean = false,
    val capabilities: RemoteCapabilities = RemoteCapabilities(),
    val defaults: HostDefaults = HostDefaults(),
    val recentDirs: List<RecentDir> = emptyList()
)

data class RemoteSendImage(val name: String, val mime: String, val data: String)

data class PendingRemoteImage(val payload: RemoteSendImage)

data class Pairing(
    val uri: String,
    val host: String,
    val port: Int,
    val secret: String,
    val name: String,
    /** Tailcat token from Settings QR (`vav-remote:{…}`). LAN pairings leave this null. */
    val remoteToken: String? = null
) {
    val token: String get() = remoteToken ?: "$host:$port:$secret"
    val displayName: String get() = name.ifBlank { host.ifBlank { "电脑" } }
    val hasLan: Boolean get() = host.isNotBlank() && port > 0
}

/** Same connection chrome as iOS `HostLinkStyle.statusLabel`. */
fun hostLinkStatusLabel(
    state: RemoteClient.State,
    sessionsLoad: RemoteClient.SessionsLoad,
    threadLoading: Boolean
): String = when (state) {
    RemoteClient.State.Connected -> when {
        sessionsLoad == RemoteClient.SessionsLoad.Loading -> "同步会话…"
        threadLoading -> "同步对话…"
        else -> "已连接"
    }
    RemoteClient.State.Connecting -> "连接中…"
    RemoteClient.State.Disconnected -> "未连接"
    RemoteClient.State.Unpaired -> "未配对"
}

/** Same subtitle ladder as iOS `SessionsView` / the desktop sidebar. */
fun relativeSessionTime(timestamp: Double, nowMs: Long = System.currentTimeMillis()): String? {
    if (timestamp <= 0) return null
    val millis = if (timestamp > 1_000_000_000_000.0) timestamp else timestamp * 1000
    val delta = nowMs - millis
    val minute = 60_000.0
    val hour = 60 * minute
    val day = 24 * hour
    return when {
        delta < minute -> "刚刚"
        delta < hour -> "${(delta / minute).toInt()} 分钟前"
        delta < day -> "${(delta / hour).toInt()} 小时前"
        delta < 2 * day -> "昨天"
        delta < 7 * day -> "${(delta / day).toInt()} 天前"
        delta < 14 * day -> "上周"
        else -> java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault())
            .format(java.util.Date(millis.toLong()))
    }
}

fun sortedRemoteSessions(sessions: List<RemoteSession>): List<RemoteSession> {
    return sessions.sortedWith(
        compareByDescending<RemoteSession> { it.pinned }
            .thenByDescending { if (it.pinned) it.pinTime else 0.0 }
            .thenByDescending { it.updatedAt }
    )
}

fun parseDaemonPairing(text: String): Pairing? {
    val trimmed = text.trim()
    if (trimmed.startsWith("vav-remote:")) return parseRemotePairing(trimmed)
    if (trimmed.startsWith("vavrtp://") || trimmed.startsWith("vav-daemon://")) {
        return try {
            val parsed = java.net.URI(trimmed)
            val secret = parsed.userInfo ?: return null
            if (secret.length < 16) return null
            val host = parsed.host ?: return null
            val port = if (parsed.port > 0) parsed.port else 4750
            val name = parsed.query
                ?.split("&")
                ?.firstOrNull { it.startsWith("name=") }
                ?.substringAfter("name=")
                ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
                ?: host
            val remoteToken = parsed.query
                ?.split("&")
                ?.firstOrNull { it.startsWith("token=") }
                ?.substringAfter("token=")
                ?.let { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
                ?.takeIf { it.startsWith("tc") }
            Pairing(
                uri = trimmed,
                host = host,
                port = port,
                secret = secret,
                name = name,
                remoteToken = remoteToken
            )
        } catch (_: Exception) {
            null
        }
    }
    return parseHostPortSecret(trimmed)
}

/** Settings QR (`vav-remote:{…}`). Same payload iOS `Pairing.parseRemote` accepts. */
fun parseRemotePairing(text: String): Pairing? {
    if (!text.startsWith("vav-remote:")) return null
    return try {
        val obj = JSONObject(text.removePrefix("vav-remote:"))
        val token = obj.optString("token")
        val secret = obj.optString("secret")
        if (!token.startsWith("tc") || secret.length < 16) return null
        val name = obj.optString("host").ifBlank { "电脑" }
        val lanHost = obj.optString("lanHost").ifBlank { obj.optString("lan_host") }
        val lanPort = obj.optInt("lanPort", obj.optInt("port", 0)).takeIf { it > 0 } ?: 0
        Pairing(
            uri = text,
            host = lanHost,
            port = lanPort,
            secret = secret,
            name = name,
            remoteToken = token
        )
    } catch (_: Exception) {
        null
    }
}

private fun parseHostPortSecret(text: String): Pairing? {
    val match = Regex("""^(\S+):(\d+)\s*[#\s]+(\S+)$""").find(text) ?: return null
    val secret = match.groupValues[3]
    if (secret.length < 16) return null
    val host = match.groupValues[1]
    val port = match.groupValues[2].toInt()
    return Pairing(uri = text, host = host, port = port, secret = secret, name = host)
}

fun encodeLine(type: String, extra: Map<String, Any?> = emptyMap()): String {
    val obj = JSONObject()
    obj.put("type", type)
    for ((key, value) in extra) {
        if (value == null) continue
        obj.put(key, value)
    }
    return obj.toString() + "\n"
}

fun jsonChoices(array: JSONArray?): List<RemoteChoice> {
    if (array == null) return emptyList()
    return buildList {
        for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            add(RemoteChoice(row.optString("id"), row.optString("label")))
        }
    }
}

fun parseThreadBlock(row: JSONObject): RemoteThreadBlock {
    val steps = row.optJSONArray("steps")
    return RemoteThreadBlock(
        kind = row.optString("kind"),
        text = row.optString("text").ifBlank { null },
        id = row.optString("id").ifBlank { null },
        tool = row.optString("tool").ifBlank { null },
        name = row.optString("name").ifBlank { null },
        summary = row.optString("summary").ifBlank { null },
        status = row.optString("status").ifBlank { null },
        title = row.optString("title").ifBlank { null },
        prompt = row.optString("prompt").ifBlank { null },
        steps = buildList {
            if (steps == null) return@buildList
            for (i in 0 until steps.length()) {
                val step = steps.optJSONObject(i) ?: continue
                add(RemotePlanStep(step.optString("text"), step.optBoolean("done")))
            }
        },
        choices = jsonChoices(row.optJSONArray("choices")),
        multiSelect = row.optBoolean("multiSelect")
    )
}

fun parseThreadBlocks(array: JSONArray?): List<RemoteThreadBlock> {
    if (array == null) return emptyList()
    return buildList {
        for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            add(parseThreadBlock(row))
        }
    }
}

fun parseSession(row: JSONObject): RemoteSession {
    return RemoteSession(
        id = row.optString("id"),
        title = row.optString("title"),
        dirLabel = row.optString("dirLabel"),
        status = row.optString("status", "idle"),
        surface = row.optString("surface", "vav"),
        updatedAt = row.optDouble("updatedAt", 0.0),
        preview = row.optString("preview").ifBlank { null },
        workdir = row.optString("workdir").ifBlank { null },
        temporary = row.optBoolean("temporary"),
        pinned = row.optBoolean("pinned"),
        pinTime = row.optDouble("pinTime", 0.0),
        favorite = row.optBoolean("favorite"),
        goal = row.optJSONObject("goal")?.let { goal ->
            val objective = goal.optString("objective")
            if (objective.isBlank()) null
            else RemoteSessionGoal(
                status = goal.optString("status", "active"),
                objective = objective,
                lastReason = goal.optString("lastReason").ifBlank { null }
            )
        }
    )
}
