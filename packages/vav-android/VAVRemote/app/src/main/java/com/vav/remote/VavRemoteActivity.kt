package com.vav.remote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.vav.remote.ui.VavRemoteApp

class VavRemoteActivity : ComponentActivity() {
    private lateinit var client: RemoteClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        DiagLog.start(this)
        RemoteNotifier.ensureChannel(this)
        RemoteNotifier.requestPermission(this)
        client = RemoteClient(lifecycleScope, PairingStore(this), applicationContext)
        setContent { VavRemoteApp(client) }
        consumeOpenIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeOpenIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        RemoteNotifier.foreground = true
        client.setForeground(true)
        DiagLog.line("scene active")
        client.connectIfNeeded()
    }

    override fun onPause() {
        RemoteNotifier.foreground = false
        client.setForeground(false)
        DiagLog.line("scene background — socket will drop")
        client.suspend()
        super.onPause()
    }

    private fun consumeOpenIntent(intent: Intent?) {
        val id = intent?.getStringExtra(RemoteNotifier.EXTRA_CONVERSATION_ID)?.ifBlank { null } ?: return
        client.openConversation(id)
    }
}
