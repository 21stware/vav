package com.vav.remote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vav.remote.DiagLog
import com.vav.remote.Pairing
import com.vav.remote.RemoteClient
import java.text.DateFormat
import java.util.Date

@Composable
fun SettingsScreen(client: RemoteClient, modifier: Modifier = Modifier) {
    val pairings by client.pairings.collectAsState()
    val host by client.host.collectAsState()
    val state by client.state.collectAsState()
    val error by client.error.collectAsState()
    val lastSyncAt by client.lastSyncAt.collectAsState()
    val context = LocalContext.current
    var adding by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var pendingForget by remember { mutableStateOf<Pairing?>(null) }

    if (adding) {
        PairingScreen(client, modifier, addMode = true) { adding = false }
        return
    }

    Column(
        modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("设置", style = MaterialTheme.typography.titleLarge)
        Text("电脑", style = MaterialTheme.typography.titleMedium)
        Text(
            "这台手机可以保存多台电脑，点一下切换。同一张二维码也可以给多台手机用。离开家里 Wi‑Fi 时走公网中继，电脑要开着且不要休眠。",
            style = MaterialTheme.typography.bodySmall
        )
        pairings.forEach { pairing ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    TextButton(onClick = { client.activate(pairing) }) { Text(pairing.displayName) }
                    Text(if (client.isActive(pairing)) "当前" else "已保存", style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = { pendingForget = pairing }) { Text("解除") }
            }
        }
        TextButton(onClick = { adding = true }) { Text("添加电脑") }
        pendingForget?.let { row ->
            AlertDialog(
                onDismissRequest = { pendingForget = null },
                title = { Text("解除与 ${row.displayName} 的配对？") },
                confirmButton = {
                    TextButton(onClick = {
                        client.forget(row)
                        pendingForget = null
                    }) { Text("解除配对") }
                },
                dismissButton = { TextButton(onClick = { pendingForget = null }) { Text("取消") } }
            )
        }

        Text("当前连接", style = MaterialTheme.typography.titleMedium)
        Text("电脑：${host?.name ?: "—"}")
        Text("状态：${state.name}")
        lastSyncAt?.let { at ->
            Text("最近同步：${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at))}")
        }
        host?.platform?.let { Text("系统：$it") }
        if (!error.isNullOrBlank()) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        TextButton(onClick = { client.connectIfNeeded() }) { Text("立即重连") }

        if (host != null) {
            val caps = host!!.capabilities
            Text("这台电脑的默认配置", style = MaterialTheme.typography.titleMedium)
            Text("Agent：${host!!.defaults.agent}")
            Text("模型：${host!!.defaults.model.ifBlank { "Default" }}")
            Text("思考：${thinkingLabel(host!!.defaults.thinking)}")
            Text("权限：${approvalLabel(host!!.defaults.approval)}")
            Text(
                "新会话使用电脑上的默认 Agent / 模型 / 思考 / 权限。每条会话里可以再改，和桌面一致。",
                style = MaterialTheme.typography.bodySmall
            )

            Text("手机可以做的事", style = MaterialTheme.typography.titleMedium)
            CapRow("新建 / 发送 / 停止", caps.cancel)
            CapRow("回答提问与批准", caps.reply)
            CapRow("重命名 / 归档", caps.rename)
            CapRow("收藏 / 置顶", caps.favorite || caps.pin)
            CapRow("选择工作区", caps.workdirPick)
            CapRow("压缩 / 复制 / 继续", true)
            CapRow("重新生成 / 编辑 / 分叉", true)
            CapRow("目标 / 定位临时工作区", true)
            CapRow("删除消息 / 设为叶子", true)

            Text("需要在电脑上做的事", style = MaterialTheme.typography.titleMedium)
            CapRow("附件与截图", caps.attachments)
            CapRow("读文件内容", caps.fsRead)
            CapRow("终端", caps.pty)
            CapRow("密钥与登录", caps.keys)
            Text(
                "工作区、Agent、密钥都在 Host 上。手机是正规客户端，但 remote 不会把文件系统和终端放到手机沙盒里。",
                style = MaterialTheme.typography.bodySmall
            )
        }

        Text("诊断日志", style = MaterialTheme.typography.titleMedium)
        Text(
            "公网连不上时：打开 App 点「立即重连」，等它失败，再导出这份日志。令牌和密钥会被打码。诊断 build 4。",
            style = MaterialTheme.typography.bodySmall
        )
        TextButton(onClick = {
            DiagLog.line("export requested")
            val send =
                Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, DiagLog.snapshot())
                    putExtra(Intent.EXTRA_SUBJECT, "vav-remote-diag")
                }
            context.startActivity(Intent.createChooser(send, "导出诊断日志"))
        }) { Text("导出诊断日志") }
        TextButton(onClick = {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("vav-remote-diag", DiagLog.snapshot()))
            copied = true
        }) { Text(if (copied) "已复制" else "复制日志") }
        TextButton(onClick = {
            DiagLog.clear()
            copied = false
        }) { Text("清空日志") }
    }
}

@Composable
private fun CapRow(title: String, on: Boolean) {
    Text("$title：${if (on) "可以" else "仅电脑"}")
}

private fun thinkingLabel(value: String?): String {
    return when (value) {
        "off" -> "关闭"
        "low" -> "低"
        "medium" -> "中"
        "high" -> "高"
        "max" -> "最高"
        else -> value ?: "—"
    }
}

private fun approvalLabel(value: String): String {
    return when (value) {
        "bypass" -> "Bypass"
        "edit" -> "Read"
        else -> "Normal"
    }
}
