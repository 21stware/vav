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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vav.remote.RemoteClient
import com.vav.remote.RemoteNotificationItem
import java.text.DateFormat
import java.util.Date

@Composable
fun NotificationsScreen(client: RemoteClient, modifier: Modifier = Modifier) {
    val items by client.notifications.collectAsState()
    Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("通知", style = MaterialTheme.typography.titleLarge)
        if (items.isEmpty()) {
            Text("暂无通知")
            Text("完成后会更新对应会话。点一条通知即可跳过去。")
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.id }) { item ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clickable { client.openFromNotification(item) }
                        .padding(vertical = 8.dp)
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            item.kindLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = kindColor(item)
                        )
                        Text(
                            DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(item.at.toLong())),
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                    Text(item.title, style = MaterialTheme.typography.bodyLarge)
                    if (item.body.isNotBlank()) Text(item.body, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { client.dismissNotification(item) }) { Text("清除") }
                }
            }
        }
    }
}

private fun kindColor(item: RemoteNotificationItem): Color {
    return when (item.kind) {
        "turn-complete" -> Color(0xFF2E7D32)
        "ask" -> Color(0xFF1565C0)
        "approval" -> Color(0xFFEF6C00)
        "request" -> Color(0xFF6A1B9A)
        else -> Color.Gray
    }
}
