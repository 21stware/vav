package com.vav.remote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.vav.remote.PendingRemoteImage
import com.vav.remote.RemoteClient
import com.vav.remote.RemoteSendImage
import com.vav.remote.RemoteSession
import com.vav.remote.RemoteSessionControls
import com.vav.remote.RemoteReviewSet
import com.vav.remote.RemoteThreadMessage
import com.vav.remote.encodeRemoteImage
import com.vav.remote.turnRecoveryLabel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class QueuedSend(val text: String, val images: List<RemoteSendImage>)

@Composable
fun SessionDetailScreen(client: RemoteClient, session: RemoteSession, modifier: Modifier = Modifier) {
    val threads by client.threads.collectAsState()
    val controls by client.controls.collectAsState()
    val drafts by client.drafts.collectAsState()
    val thinking by client.thinking.collectAsState()
    val awaiting by client.awaiting.collectAsState()
    val liveBlocksMap by client.liveBlocks.collectAsState()
    val recoveries by client.recoveries.collectAsState()
    val generatingIds by client.generatingIds.collectAsState()
    val reviews by client.reviews.collectAsState()
    val host by client.host.collectAsState()
    val linkState by client.state.collectAsState()
    val threadLoad by client.threadLoad.collectAsState()
    val linkError by client.error.collectAsState()
    val sendError by client.sendError.collectAsState()
    val sendErrorConversationId by client.sendErrorConversationId.collectAsState()
    val live = client.sessions.collectAsState().value.firstOrNull { it.id == session.id } ?: session
    val run = controls[session.id]
    val messages = threads[session.id].orEmpty()
    val liveDraft = drafts[session.id].orEmpty()
    val liveThinking = thinking[session.id].orEmpty()
    val liveBlocks = liveBlocksMap[session.id].orEmpty()
    val isRunning = live.status == "running" || session.id in generatingIds
    val isConnected = linkState == RemoteClient.State.Connected
    val caps = host?.capabilities
    var draft by remember { mutableStateOf("") }
    var pendingImages by remember { mutableStateOf<List<PendingRemoteImage>>(emptyList()) }
    var pickPurpose by remember { mutableStateOf<String?>(null) }
    var showRename by remember { mutableStateOf(false) }
    var renameTitle by remember { mutableStateOf(live.title) }
    var showGoal by remember { mutableStateOf(false) }
    var goalTitle by remember { mutableStateOf("") }
    var showEdit by remember { mutableStateOf(false) }
    var editTitle by remember { mutableStateOf("") }
    var editMessageId by remember { mutableStateOf("") }
    var queue by remember { mutableStateOf<List<QueuedSend>>(emptyList()) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(4)
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch(Dispatchers.IO) {
            val next = uris.mapNotNull { encodeRemoteImage(context, it) }
            withContext(Dispatchers.Main) {
                pendingImages = (pendingImages + next).take(4)
            }
        }
    }

    LaunchedEffect(session.id) {
        client.setViewingConversation(session.id)
        client.requestThread(session.id)
        client.requestControls(session.id)
    }

    LaunchedEffect(isConnected, session.id) {
        if (isConnected) {
            client.requestThread(session.id)
            client.requestControls(session.id)
        }
    }

    DisposableEffect(session.id) {
        onDispose { client.setViewingConversation(null, session.id) }
    }

    LaunchedEffect(isRunning) {
        if (!isRunning && queue.isNotEmpty()) {
            val next = queue.first()
            queue = queue.drop(1)
            client.send(session.id, next.text, next.images)
        }
    }

    if (pickPurpose != null) {
        WorkspacePicker(client, session.id, modifier, purpose = pickPurpose!!) { pickPurpose = null }
        return
    }

    if (showRename) {
        AlertDialog(
            onDismissRequest = { showRename = false },
            title = { Text("重命名会话") },
            text = {
                OutlinedTextField(
                    value = renameTitle,
                    onValueChange = { renameTitle = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("标题") }
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val title = renameTitle.trim()
                        if (title.isNotEmpty()) client.rename(session.id, title)
                        showRename = false
                    }
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showRename = false }) { Text("取消") } }
        )
    }

    if (showEdit) {
        AlertDialog(
            onDismissRequest = { showEdit = false },
            title = { Text("编辑上一条") },
            text = {
                OutlinedTextField(
                    value = editTitle,
                    onValueChange = { editTitle = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("消息") }
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val text = editTitle.trim()
                        if (text.isNotEmpty() && editMessageId.isNotEmpty()) {
                            client.edit(session.id, editMessageId, text)
                        }
                        showEdit = false
                    }
                ) { Text("发送") }
            },
            dismissButton = { TextButton(onClick = { showEdit = false }) { Text("取消") } }
        )
    }

    if (showGoal) {
        AlertDialog(
            onDismissRequest = { showGoal = false },
            title = { Text("设置目标") },
            text = {
                OutlinedTextField(
                    value = goalTitle,
                    onValueChange = { goalTitle = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("目标") }
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val text = goalTitle.trim()
                        if (text.isNotEmpty()) client.applyGoal(session.id, "set", text)
                        showGoal = false
                    }
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { showGoal = false }) { Text("取消") } }
        )
    }

    if (sendErrorConversationId == session.id && !sendError.isNullOrBlank()) {
        AlertDialog(
            onDismissRequest = { client.clearSendError() },
            title = { Text("发送失败") },
            text = { Text(sendError!!) },
            confirmButton = { TextButton(onClick = { client.clearSendError() }) { Text("好") } }
        )
    }

    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { client.clearOpenRequest() }) { Text("会话") }
            Text(if (isRunning) "Generating…" else live.status, style = MaterialTheme.typography.labelMedium)
        }
        Text(live.title.ifBlank { live.id }, style = MaterialTheme.typography.titleMedium)
        Text(if (live.temporary) "临时工作区" else live.dirLabel.ifBlank { "未选择文件夹" })
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = {
                renameTitle = live.title
                showRename = true
            }) { Text("重命名") }
            if (caps?.favorite == true) {
                TextButton(onClick = { client.setFavorite(session.id, !live.favorite) }) {
                    Text(if (live.favorite) "取消收藏" else "收藏")
                }
            }
            if (caps?.pin == true) {
                TextButton(onClick = { client.setPinned(session.id, !live.pinned) }) {
                    Text(if (live.pinned) "取消置顶" else "置顶")
                }
            }
            TextButton(onClick = { pickPurpose = "workdir" }) { Text("换文件夹") }
            if (live.temporary) {
                TextButton(onClick = { pickPurpose = "locate" }) { Text("定位到文件夹") }
            }
            TextButton(onClick = {
                goalTitle = live.goal?.objective.orEmpty()
                showGoal = true
            }) { Text("设置目标") }
            TextButton(onClick = { client.workspace(session.id, temp = true) }) { Text("新建临时工作区") }
            TextButton(onClick = { client.compact(session.id) }) { Text("压缩上下文") }
            TextButton(onClick = { client.duplicate(session.id) }) { Text("复制会话") }
            messages.lastOrNull()?.let { last ->
                TextButton(onClick = { client.continueInNew(session.id, last.id) }) { Text("在新会话继续") }
            }
            messages.lastOrNull { it.role == "assistant" }?.let { assistant ->
                TextButton(onClick = { client.regenerate(session.id, assistant.id) }) { Text("重新生成") }
            }
            messages.lastOrNull { it.role == "user" }?.let { user ->
                TextButton(onClick = {
                    editTitle = user.text
                    editMessageId = user.id
                    showEdit = true
                }) { Text("编辑上一条") }
                TextButton(onClick = { client.fork(session.id, user.id) }) { Text("分叉") }
            }
            messages.lastOrNull()?.let { last ->
                TextButton(onClick = { client.deleteMessage(session.id, last.id) }) { Text("删除上一条") }
                TextButton(onClick = { client.setLeaf(session.id, last.id) }) { Text("设为当前叶子") }
            }
            if (isRunning) {
                TextButton(onClick = { client.cancel(session.id) }) { Text("停止生成") }
            }
            TextButton(onClick = {
                client.archive(session.id)
                client.clearOpenRequest()
            }) { Text("归档") }
        }
        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            live.goal?.let { goal ->
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("目标 · ${goal.statusLabel}", style = MaterialTheme.typography.labelMedium)
                        Text(goal.objective, style = MaterialTheme.typography.titleSmall)
                        if (!goal.lastReason.isNullOrBlank()) {
                            Text(goal.lastReason, style = MaterialTheme.typography.bodySmall)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (goal.status == "active") {
                                TextButton(onClick = { client.applyGoal(session.id, "pause") }) { Text("暂停") }
                            }
                            if (goal.status == "paused" || goal.status == "blocked" || goal.status == "limited") {
                                TextButton(onClick = { client.applyGoal(session.id, "resume") }) { Text("继续") }
                            }
                            TextButton(onClick = { client.applyGoal(session.id, "clear") }) { Text("清除") }
                        }
                    }
                }
            }
            if (linkState != RemoteClient.State.Connected && messages.isEmpty()) {
                item {
                    Text("还没连上电脑", style = MaterialTheme.typography.titleSmall)
                    Text(
                        when {
                            linkState == RemoteClient.State.Connecting -> "正在经公网中继连接…离开 Wi‑Fi 时会慢一些。"
                            !linkError.isNullOrBlank() -> linkError!!
                            else -> "离开家里的 Wi‑Fi 后，手机要经公网中继才能连到这台电脑。请确认电脑没休眠、VAV 开着。"
                        }
                    )
                    TextButton(onClick = { client.connectIfNeeded() }) { Text("重试连接") }
                }
            } else if (threadLoad[session.id] == RemoteClient.SessionsLoad.Unavailable) {
                item { Text("对话同步超时。下拉返回再进，或到设置里点立即重连。") }
                item { TextButton(onClick = { client.requestThread(session.id) }) { Text("重试连接") } }
            } else if (threadLoad[session.id] == RemoteClient.SessionsLoad.Offline && messages.isEmpty()) {
                item { Text("还没连上电脑") }
                item { TextButton(onClick = { client.connectIfNeeded() }) { Text("重试连接") } }
            } else if (threadLoad[session.id] == RemoteClient.SessionsLoad.Loading && messages.isEmpty()) {
                item { Text("正在同步对话…公网会慢一些，请稍等") }
            } else if (threadLoad[session.id] == RemoteClient.SessionsLoad.Loading) {
                item { Text("正在更新对话…") }
            } else if (messages.isEmpty() && liveDraft.isEmpty() && liveBlocks.isEmpty()) {
                item { Text("Harnessed by VAV", style = MaterialTheme.typography.titleSmall) }
                item {
                    Text(
                        "工作区是 ${if (live.temporary) "临时工作区" else live.dirLabel.ifBlank { "未选择文件夹" }}。"
                    )
                }
            }
            items(messages, key = { it.id }) { message ->
                ThreadTurn(
                    message = message,
                    review = message.changeSetId?.let { reviews[it] },
                    onReply = { toolCallId, answer ->
                        client.reply(session.id, toolCallId, answer)
                    },
                    onReview = { setId, action ->
                        client.review(session.id, action, setId)
                    }
                )
            }
            val waiting = awaiting[session.id]
            if (waiting != null && messages.none { row -> row.blocks.any { it.kind == "awaiting" && it.id == waiting.id } }) {
                item {
                    AwaitingCard(waiting) { toolCallId, answer ->
                        client.reply(session.id, toolCallId, answer)
                    }
                }
            }
            if (recoveries[session.id] != null || liveBlocks.isNotEmpty() || liveThinking.isNotEmpty() || liveDraft.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        recoveries[session.id]?.let { recovery ->
                            Text(
                                turnRecoveryLabel(recovery.kind),
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.testTag("stream-status")
                            )
                        }
                        if (liveBlocks.isNotEmpty()) {
                            AgentBlockStack(liveBlocks) { toolCallId, answer ->
                                client.reply(session.id, toolCallId, answer)
                            }
                        } else {
                            if (liveThinking.isNotEmpty()) ThinkingBlock(liveThinking)
                            if (liveDraft.isNotEmpty()) Text(liveDraft)
                        }
                    }
                }
            }
        }

        if (queue.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("排队 ${queue.size} 条（流式结束后发送）", style = MaterialTheme.typography.labelSmall)
                queue.forEachIndexed { index, item ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(item.text.ifBlank { "（附件）" }, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { queue = queue.filterIndexed { i, _ -> i != index } }) {
                            Text("移除")
                        }
                    }
                }
            }
        }
        if (pendingImages.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("已选 ${pendingImages.size} 张照片")
                TextButton(onClick = { pendingImages = pendingImages.dropLast(1) }) { Text("去掉一张") }
                TextButton(onClick = { pendingImages = emptyList() }) { Text("清空照片") }
            }
        }
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
            label = {
                Text(
                    when {
                        !isConnected -> "等待连接到电脑…"
                        !isRunning -> "给 Agent 发消息…"
                        queue.size >= 20 -> "消息队列已满（最多 20 条）"
                        else -> "输入消息…（流式中发送将排队）"
                    }
                )
            }
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            TextButton(
                onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                enabled = isConnected && pendingImages.size < 4
            ) { Text("添加照片") }
            if (run != null) {
                SessionRunBar(run, Modifier.weight(1f)) { key, value ->
                    when (key) {
                        "mode" -> client.configure(session.id, mode = value)
                        "approvalMode" -> client.configure(session.id, approvalMode = value)
                        "agent" -> client.configure(session.id, agent = value)
                        "model" -> client.configure(session.id, model = value)
                        "thinkingLevel" -> client.configure(session.id, thinkingLevel = value)
                        "fast" -> client.configure(session.id, fast = value == "1")
                    }
                }
            }
            if (isRunning) {
                TextButton(onClick = { client.cancel(session.id) }) { Text("停止") }
            }
            Button(
                onClick = {
                    val text = draft.trim()
                    val images = pendingImages.map { it.payload }
                    val payload = if (text.isEmpty() && images.isNotEmpty()) "（附件）" else text
                    draft = ""
                    pendingImages = emptyList()
                    if (isRunning) {
                        if (queue.size < 20) queue = queue + QueuedSend(payload, images)
                    } else {
                        client.send(session.id, payload, images)
                    }
                },
                enabled = isConnected &&
                    (draft.isNotBlank() || pendingImages.isNotEmpty()) &&
                    !(isRunning && queue.size >= 20)
            ) { Text(if (isRunning) "加入队列" else "Send") }
        }
    }
}

@Composable
private fun ThreadTurn(
    message: RemoteThreadMessage,
    review: RemoteReviewSet? = null,
    onReply: (toolCallId: String, answer: String) -> Unit,
    onReview: (setId: String, action: String) -> Unit = { _, _ -> }
) {
    val context = LocalContext.current
    val isUser = message.role == "user"
    val isSystem = message.role == "system"
    val lines = message.text.count { it == '\n' } + 1
    val collapsible = isUser && (message.text.length > 400 || lines > 8)
    var expanded by remember(message.id) { mutableStateOf(false) }
    var reviewStatus by remember(message.id) { mutableStateOf<String?>(null) }
    val body = if (collapsible && !expanded) {
        message.text.lineSequence().take(4).joinToString("\n").let { clipped ->
            if (clipped.length > 280) clipped.take(280) + "…" else clipped
        }
    } else {
        message.text
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (!isSystem) {
            Text(if (isUser) "You" else "Agent", style = MaterialTheme.typography.labelMedium)
        }
        if (isSystem) {
            Text(message.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else if (message.blocks.isNotEmpty()) {
            AgentBlockStack(message.blocks, onReply)
        } else if (isUser) {
            Text(body)
        } else {
            AgentMarkdown(message.text)
        }
        if (message.cancelled) Text("已停止", style = MaterialTheme.typography.labelSmall)
        if (!message.error.isNullOrBlank()) {
            Text(message.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (collapsible) {
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "收起" else "展开")
                }
            }
            TextButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("vav-remote-message", message.text))
                }
            ) { Text("拷贝") }
        }
        val setId = message.changeSetId
        if (!setId.isNullOrBlank()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("改动审查", style = MaterialTheme.typography.labelMedium)
                review?.files?.forEach { file ->
                    Text(file.name, style = MaterialTheme.typography.bodySmall)
                }
                if (reviewStatus != null) {
                    Text(
                        if (reviewStatus == "accepted") "已接受" else "已拒绝",
                        style = MaterialTheme.typography.bodySmall
                    )
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = {
                            onReview(setId, "accept-all")
                            reviewStatus = "accepted"
                        }) { Text("全部接受") }
                        TextButton(onClick = {
                            onReview(setId, "reject-all")
                            reviewStatus = "rejected"
                        }) { Text("全部拒绝") }
                    }
                }
            }
        }
    }
}

/** [mode · permission]  agent+model  [thinking · Fast] — same chrome as desktop / iOS. */
@Composable
private fun SessionRunBar(
    run: RemoteSessionControls,
    modifier: Modifier = Modifier,
    onPick: (String, String) -> Unit
) {
    Column(modifier) {
        Text("mode · permission", style = MaterialTheme.typography.labelSmall)
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            run.modes.take(4).forEach { choice ->
                FilterChip(
                    selected = run.mode == choice.id,
                    onClick = { onPick("mode", choice.id) },
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
            run.approvals.take(3).forEach { choice ->
                FilterChip(
                    selected = run.approval == choice.id,
                    onClick = { onPick("approvalMode", choice.id) },
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
            run.agents.take(3).forEach { choice ->
                FilterChip(
                    selected = run.agent == choice.id,
                    onClick = { onPick("agent", choice.id) },
                    enabled = !run.agentLocked,
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
            run.models.take(4).forEach { choice ->
                FilterChip(
                    selected = run.model == choice.id,
                    onClick = { onPick("model", choice.id) },
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
        }
        Text("thinking · Fast", style = MaterialTheme.typography.labelSmall)
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            run.thinkingLevels.take(4).forEach { choice ->
                FilterChip(
                    selected = run.thinking == choice.id,
                    onClick = { onPick("thinkingLevel", choice.id) },
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
            if (run.fast != null) {
                FilterChip(
                    selected = run.fast == true,
                    onClick = { onPick("fast", if (run.fast == true) "0" else "1") },
                    label = { Text("Fast") }
                )
            }
        }
    }
}
