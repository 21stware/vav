package com.vav.remote

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Lock-screen banners when the app is backgrounded — same as iOS `postLocalNotification`. */
object RemoteNotifier {
    const val CHANNEL_ID = "vav.remote"
    const val EXTRA_CONVERSATION_ID = "conversationId"

    @Volatile
    var foreground = true

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "VAV Remote", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    fun requestPermission(activity: Activity) {
        if (Build.VERSION.SDK_INT < 33) return
        if (
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
    }

    fun post(context: Context, item: RemoteNotificationItem) {
        if (foreground) return
        ensureChannel(context)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val open =
            Intent(context, VavRemoteActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(EXTRA_CONVERSATION_ID, item.conversationId)
            }
        val pending =
            PendingIntent.getActivity(
                context,
                item.id.hashCode(),
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        val notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("${item.kindLabel} · ${item.title}")
                .setContentText(item.body)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
        NotificationManagerCompat.from(context).notify(item.id.hashCode(), notification)
    }
}
