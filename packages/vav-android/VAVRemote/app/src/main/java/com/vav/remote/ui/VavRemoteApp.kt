package com.vav.remote.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.vav.remote.RemoteClient
import com.vav.remote.RemoteTab

@Composable
fun VavRemoteApp(client: RemoteClient) {
    val state by client.state.collectAsState()
    val tab by client.tab.collectAsState()
    val pairings by client.pairings.collectAsState()

    if (state == RemoteClient.State.Unpaired && pairings.isEmpty()) {
        PairingScreen(client, addMode = false)
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == RemoteTab.Sessions,
                    onClick = { client.selectTab(RemoteTab.Sessions) },
                    icon = { Text("会话") },
                    label = { Text("会话") }
                )
                NavigationBarItem(
                    selected = tab == RemoteTab.Notifications,
                    onClick = { client.selectTab(RemoteTab.Notifications) },
                    icon = { Text("通知") },
                    label = { Text("通知") }
                )
                NavigationBarItem(
                    selected = tab == RemoteTab.Settings,
                    onClick = { client.selectTab(RemoteTab.Settings) },
                    icon = { Text("设置") },
                    label = { Text("设置") }
                )
            }
        }
    ) { padding ->
        when (tab) {
            RemoteTab.Sessions -> SessionsScreen(client, Modifier.padding(padding))
            RemoteTab.Notifications -> NotificationsScreen(client, Modifier.padding(padding))
            RemoteTab.Settings -> SettingsScreen(client, Modifier.padding(padding))
        }
    }
}
