package com.vav.remote

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Same line-size budget as iOS `SEND_IMAGE_DATA_CAP` / `remoteControl.ts`. */
const val SEND_IMAGE_DATA_CAP = 180_000

fun encodeRemoteImage(context: Context, uri: Uri): PendingRemoteImage? {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val scaled = scaleForRemote(bitmap)
    if (scaled !== bitmap) bitmap.recycle()
    try {
        var quality = 72
        while (quality > 28) {
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
            val encoded = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            if (encoded.isNotEmpty() && encoded.length <= SEND_IMAGE_DATA_CAP) {
                return PendingRemoteImage(RemoteSendImage("photo.jpg", "image/jpeg", encoded))
            }
            quality -= 12
        }
        return null
    } finally {
        scaled.recycle()
    }
}

private fun scaleForRemote(source: Bitmap, maxEdge: Int = 1280): Bitmap {
    val longest = maxOf(source.width, source.height)
    if (longest <= maxEdge) return source
    val scale = maxEdge.toFloat() / longest.toFloat()
    val width = (source.width * scale).toInt().coerceAtLeast(1)
    val height = (source.height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, width, height, true)
}
