package com.vav.remote.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vav.remote.RemoteClient

@Composable
fun WorkspacePicker(
    client: RemoteClient,
    conversationId: String,
    modifier: Modifier = Modifier,
    purpose: String = "workdir",
    onClose: () -> Unit
) {
    val locating = purpose == "locate"
    val dirs by client.dirs.collectAsState()
    val host by client.host.collectAsState()
    val listing = dirs[conversationId]

    LaunchedEffect(conversationId) { client.browse(conversationId) }

    Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        RowHeader(onClose)
        Text(if (locating) "定位临时工作区" else "工作区", style = MaterialTheme.typography.titleLarge)
        Text(
            if (locating) "把这条临时工作区落到电脑上的一个文件夹，和桌面「定位」相同。"
            else "手机不能读文件内容、不能开终端。只能给这条会话换 Host 上的工作目录。"
        )
        if (!locating) {
            TextButton(onClick = {
                client.workspace(conversationId, temp = true)
                onClose()
            }) { Text("新建临时工作区") }
        }
        host?.recentDirs?.forEach { row ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        if (locating) client.locateWorkspace(conversationId, row.path)
                        else client.workspace(conversationId, path = row.path)
                        onClose()
                    }
                    .padding(vertical = 6.dp)
            ) {
                Text(row.label)
                Text(row.path, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (listing != null) {
            Text(listing.path.ifBlank { "位置" }, style = MaterialTheme.typography.titleMedium)
            if (listing.parent != null) {
                TextButton(onClick = { client.browse(conversationId, listing.parent) }) { Text("上级目录") }
            }
            LazyColumn {
                items(listing.entries, key = { it.path }) { entry ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text(
                            entry.name,
                            modifier = Modifier.clickable { client.browse(conversationId, entry.path) }
                        )
                        TextButton(onClick = {
                            if (locating) client.locateWorkspace(conversationId, entry.path)
                            else client.workspace(conversationId, path = entry.path)
                            onClose()
                        }) { Text("使用") }
                    }
                }
            }
            if (listing.path.isNotEmpty()) {
                TextButton(onClick = {
                    if (locating) client.locateWorkspace(conversationId, listing.path)
                    else client.workspace(conversationId, path = listing.path)
                    onClose()
                }) { Text("使用这里") }
            }
        }
    }
}

@Composable
private fun RowHeader(onClose: () -> Unit) {
    TextButton(onClick = onClose) { Text("关闭") }
}
