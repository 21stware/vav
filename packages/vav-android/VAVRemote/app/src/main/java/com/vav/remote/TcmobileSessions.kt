package com.vav.remote

/**
 * gomobile `tcmobile.Tcmobile.dial` — same Go surface iOS binds as `TcmobileDial`.
 * The AAR is produced by `node scripts/build-tailcat-android.mjs` and is optional
 * at compile time so Studio still opens without the NDK.
 */
object TcmobileSessions {
    fun available(): Boolean =
        try {
            Class.forName("tcmobile.Tcmobile")
            true
        } catch (_: ClassNotFoundException) {
            false
        }

    fun dial(token: String): LineSession {
        val clazz = Class.forName("tcmobile.Tcmobile")
        val session =
            clazz.getMethod("dial", String::class.java).invoke(null, token)
                ?: throw IllegalStateException("无法连接到电脑")
        return TunnelLineSession(session)
    }
}

private class TunnelLineSession(private val session: Any) : LineSession {
    override fun send(line: String) {
        val payload = line.trimEnd('\n', '\r')
        session.javaClass.getMethod("writeLine", String::class.java).invoke(session, payload)
    }

    override fun readLines(onLine: (String) -> Unit) {
        val read = session.javaClass.getMethod("readLine")
        while (true) {
            val line =
                try {
                    read.invoke(session) as? String
                } catch (err: Exception) {
                    break
                } ?: break
            if (line.isNotBlank()) onLine(line)
        }
    }

    override fun close() {
        try {
            session.javaClass.getMethod("close").invoke(session)
        } catch (_: Exception) {
        }
    }
}
