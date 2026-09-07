package com.vav.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vav.remote.RemoteClient
import com.vav.remote.RemoteHostSnapshot
import com.vav.remote.RemoteSession
import com.vav.remote.RemoteTurnRecovery
import com.vav.remote.hostLinkStatusLabel
import com.vav.remote.relativeSessionTime
import com.vav.remote.turnRecoveryLabel
import kotlinx.coroutines.launch

@Composable
fun SessionsScreen(client: RemoteClient, modifier: Modifier = Modifier) {
    val sessions by client.sessions.collectAsState()
    val host by client.host.collectAsState()
    val openId by client.openId.collectAsState()
    val state by client.state.collectAsState()
    val sessionsLoad by client.sessionsLoad.collectAsState()
    val threadLoad by client.threadLoad.collectAsState()
    val recoveries by client.recoveries.collectAsState()
    val creating by client.creating.collectAsState()
    val notice by client.notice.collectAsState()
    var favoritesOnly by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val selected = sessions.firstOrNull { it.id == openId }
    val canCreate = state == RemoteClient.State.Connected && !creating
    val status = hostLinkStatusLabel(
        state,
        sessionsLoad,
        threadLoad.values.any { it == RemoteClient.SessionsLoad.Loading }
    )

    if (selected != null) {
        SessionDetailScreen(client, selected, modifier)
        return
    }

    if (!notice.isNullOrBlank()) {
        AlertDialog(
            onDismissRequest = { client.clearNotice() },
            title = { Text("无法新建会话") },
            text = { Text(notice!!) },
            confirmButton = { TextButton(onClick = { client.clearNotice() }) { Text("好") } }
        )
    }

    val visible = if (favoritesOnly) sessions.filter { it.favorite } else sessions
    val pinned = visible.filter { it.pinned }
    val loose = visible.filter { !it.pinned }

    Column(modifier = modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text(host?.name ?: "VAV", style = MaterialTheme.typography.titleLarge)
                Text(status, style = MaterialTheme.typography.labelSmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = { scope.launch { client.refreshSessionsAndWait() } }) { Text("刷新") }
                TextButton(onClick = { client.createSession() }, enabled = canCreate) {
                    Text(if (creating) "正在新建…" else "新会话")
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !favoritesOnly, onClick = { favoritesOnly = false }, label = { Text("全部") })
            FilterChip(selected = favoritesOnly, onClick = { favoritesOnly = true }, label = { Text("收藏") })
        }
        if (visible.isEmpty()) {
            if (state == RemoteClient.State.Connecting || sessionsLoad == RemoteClient.SessionsLoad.Loading) {
                Text(if (state == RemoteClient.State.Connecting) "正在连接电脑…" else "正在同步会话…")
            } else {
                Text(if (favoritesOnly) "没有收藏" else "暂无会话")
                Text(emptyHint(favoritesOnly, sessions.isNotEmpty(), state, sessionsLoad), style = MaterialTheme.typography.bodySmall)
            }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (pinned.isNotEmpty()) {
                item { Text("置顶", style = MaterialTheme.typography.labelMedium) }
                items(pinned, key = { it.id }) { SessionRow(client, it, recoveries[it.id], host) }
                item { Text("会话", style = MaterialTheme.typography.labelMedium) }
            }
            items(loose, key = { it.id }) { SessionRow(client, it, recoveries[it.id], host) }
        }
    }
}

private fun emptyHint(
    favoritesOnly: Boolean,
    hasSessions: Boolean,
    state: RemoteClient.State,
    sessionsLoad: RemoteClient.SessionsLoad
): String = when {
    favoritesOnly && hasSessions -> "右滑会话可以收藏，和电脑侧栏是同一份。"
    sessionsLoad == RemoteClient.SessionsLoad.Loading -> "正在同步会话…"
    state == RemoteClient.State.Connected -> "点右上角 + 新建会话，或在 Mac 上开一个。"
    state == RemoteClient.State.Connecting -> "正在经公网中继连接电脑…"
    else -> "未连接到电脑。离开 Wi‑Fi 后需要中继，点设置里的立即重连。"
}

@Composable
private fun SessionRow(
    client: RemoteClient,
    session: RemoteSession,
    recovery: RemoteTurnRecovery? = null,
    host: RemoteHostSnapshot? = null
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { client.openConversation(session.id) }
            .padding(vertical = 8.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(session.title.ifBlank { session.id }, style = MaterialTheme.typography.bodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (session.favorite) Text("★")
                if (session.pinned) Text("📌")
            }
        }
        Text(
            sessionSubtitle(session, recovery),
            style = MaterialTheme.typography.bodySmall
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (host?.capabilities?.favorite == true) {
                TextButton(onClick = { client.setFavorite(session.id, !session.favorite) }) {
                    Text(if (session.favorite) "取消收藏" else "收藏")
                }
            }
            if (host?.capabilities?.pin == true) {
                TextButton(onClick = { client.setPinned(session.id, !session.pinned) }) {
                    Text(if (session.pinned) "取消置顶" else "置顶")
                }
            }
            TextButton(onClick = { client.archive(session.id) }) { Text("归档") }
        }
    }
}

private fun sessionSubtitle(session: RemoteSession, recovery: RemoteTurnRecovery? = null): String {
    if (recovery != null) return turnRecoveryLabel(recovery.kind)
    if (session.status == "running") return "流式中"
    val age = relativeSessionTime(session.updatedAt)
    val dir = if (session.temporary || session.dirLabel.isBlank()) null else session.dirLabel
    return listOfNotNull(age, dir).joinToString(" · ").ifBlank { session.status }
}
