package com.vav.remote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import com.vav.remote.RemoteClient
import com.vav.remote.parseDaemonPairing

@Composable
fun PairingScreen(
    client: RemoteClient,
    modifier: Modifier = Modifier,
    addMode: Boolean = false,
    onDismiss: (() -> Unit)? = null
) {
    var pairing by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    var consumed by remember { mutableStateOf(false) }

    fun adopt(text: String) {
        val parsed = parseDaemonPairing(text.trim())
        if (parsed == null) {
            failed = true
            return
        }
        failed = false
        consumed = true
        client.pair(text)
        if (addMode) onDismiss?.invoke()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (addMode) {
            TextButton(onClick = { onDismiss?.invoke() }) { Text("取消") }
        }
        Text(if (addMode) "添加电脑" else "配对", style = MaterialTheme.typography.headlineSmall)
        if (!addMode) {
            Text("VAV Remote", style = MaterialTheme.typography.titleMedium)
        }
        QrScanner(
            onCode = { code ->
                if (consumed) return@QrScanner
                if (parseDaemonPairing(code) != null) adopt(code)
            },
            modifier = Modifier.clip(RoundedCornerShape(16.dp))
        )
        Text(
            if (addMode) {
                "扫描另一台电脑上的配对二维码。已保存的电脑不会被覆盖。"
            } else {
                "在电脑上打开 VAV → 设置 → 连接，扫描二维码，或粘贴 vavd 打印的配对 URI。"
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedTextField(
            value = pairing,
            onValueChange = { pairing = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("或粘贴 vav-remote: / vavrtp:// 配对串") }
        )
        Button(onClick = { adopt(pairing) }, enabled = pairing.isNotBlank()) {
            Text("配对")
        }
        if (failed) {
            Text("配对串无效，请重试。", color = MaterialTheme.colorScheme.error)
        }
    }
}
