package com.vav.remote

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Ring + file diagnostic log so a failed WAN dial can be exported from Settings.
 * Same surface as iOS `DiagLog`: redact `tc…` tokens and pairing secrets.
 */
object DiagLog {
    private const val MAX_LINES = 800
    private val lock = Any()
    private val io = Executors.newSingleThreadExecutor()
    private val lines = ArrayList<String>()
    private var app: Context? = null
    private var lastPath = ""
    private var pathCallback: ConnectivityManager.NetworkCallback? = null

    private fun file(): File? {
        val dir = app?.cacheDir ?: return null
        return File(dir, "vav-remote-diag.log")
    }

    fun start(context: Context) {
        val appContext = context.applicationContext
        synchronized(lock) {
            app = appContext
            val existing = file()?.takeIf { it.exists() }?.readText(Charsets.UTF_8).orEmpty()
            if (existing.isNotBlank()) {
                lines.clear()
                lines.addAll(existing.split('\n').filter { it.isNotEmpty() })
                if (lines.size > MAX_LINES) {
                    val keep = lines.takeLast(MAX_LINES)
                    lines.clear()
                    lines.addAll(keep)
                }
            }
        }
        line("diag start ${header()}")
        startPathMonitor(appContext)
    }

    fun line(message: String) {
        val text = "${stamp()} ${redact(message)}"
        io.execute {
            synchronized(lock) {
                lines.add(text)
                if (lines.size > MAX_LINES) {
                    val keep = lines.takeLast(MAX_LINES)
                    lines.clear()
                    lines.addAll(keep)
                }
                persistLocked()
            }
        }
        Log.i("vav-diag", text)
    }

    fun ingestGo() {
        val go = snapshotGoLogs().trim()
        if (go.isEmpty()) return
        synchronized(lock) {
            for (raw in go.split('\n')) {
                val row = raw.trim()
                if (row.isEmpty()) continue
                if (lines.none { it.endsWith(row) || it.contains(row) }) {
                    lines.add("${stamp()} [tc] ${redact(row)}")
                }
            }
            if (lines.size > MAX_LINES) {
                val keep = lines.takeLast(MAX_LINES)
                lines.clear()
                lines.addAll(keep)
            }
            persistLocked()
        }
    }

    fun snapshot(): String {
        ingestGo()
        return synchronized(lock) {
            (listOf(header(), "") + lines).joinToString("\n")
        }
    }

    fun clear() {
        clearGoLogs()
        synchronized(lock) {
            lines.clear()
            persistLocked()
        }
        line("diag cleared")
    }

    fun tokenHint(token: String): String {
        if (token.length <= 8) return "len=${token.length}"
        return "${token.take(6)}… len=${token.length}"
    }

    fun redact(text: String): String {
        var out = text
        out = TC_TOKEN.replace(out, "tc…")
        out = SECRET_JSON.replace(out, "\"$1\":\"…\"")
        return out
    }

    private fun header(): String {
        val ctx = app
        val version =
            try {
                ctx?.packageManager?.getPackageInfo(ctx.packageName, 0)?.versionName ?: "?"
            } catch (_: Exception) {
                "?"
            }
        return "VAV Remote $version Android ${Build.VERSION.RELEASE} ${Build.MODEL}"
    }

    private fun startPathMonitor(context: Context) {
        if (pathCallback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    logPath(cm, network)
                }

                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    logPath(cm, network, caps)
                }

                override fun onLost(network: Network) {
                    line("path unsatisfied via=lost")
                }
            }
        try {
            cm.registerDefaultNetworkCallback(callback)
            pathCallback = callback
            cm.activeNetwork?.let { logPath(cm, it) }
        } catch (err: Exception) {
            line("path monitor fail ${err.message}")
        }
    }

    private fun logPath(
        cm: ConnectivityManager,
        network: Network,
        caps: NetworkCapabilities? = cm.getNetworkCapabilities(network)
    ) {
        val summary = describe(caps)
        synchronized(lock) {
            if (summary == lastPath) return
            lastPath = summary
        }
        line("path $summary")
    }

    private fun describe(caps: NetworkCapabilities?): String {
        if (caps == null) return "unsatisfied via=none"
        val kinds = mutableListOf<String>()
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) kinds.add("wifi")
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) kinds.add("cellular")
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) kinds.add("wired")
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) kinds.add("vpn")
        if (kinds.isEmpty()) kinds.add("other")
        val status = if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) "satisfied" else "unsatisfied"
        val expensive = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        val constrained = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED)
        return "$status via=${kinds.joinToString("+")} expensive=$expensive constrained=$constrained"
    }

    private fun persistLocked() {
        try {
            file()?.writeText(lines.joinToString("\n"), Charsets.UTF_8)
        } catch (_: Exception) {
        }
    }

    private fun stamp(): String {
        val f = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
        return f.format(Date())
    }

    private fun snapshotGoLogs(): String {
        return invokeTcmobile("snapshotLogs") ?: invokeTcmobile("SnapshotLogs") ?: ""
    }

    private fun clearGoLogs() {
        invokeTcmobile("clearLogs")
        invokeTcmobile("ClearLogs")
    }

    private fun invokeTcmobile(method: String): String? {
        return try {
            val clazz = Class.forName("tcmobile.Tcmobile")
            val found = clazz.methods.firstOrNull { it.name == method && it.parameterCount == 0 } ?: return null
            found.invoke(null)?.toString()
        } catch (_: Exception) {
            null
        }
    }

    private val TC_TOKEN = Regex("tc[A-Za-z0-9_-]{10,}")
    private val SECRET_JSON = Regex("\"(secret|auth)\"\\s*:\\s*\"[^\"]+\"")
}
