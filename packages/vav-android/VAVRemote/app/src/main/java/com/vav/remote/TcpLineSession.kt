package com.vav.remote

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.StandardCharsets

/**
 * One JSON object per `\n`, same as iOS `TcpLineSession` and the desktop phone client.
 */
class TcpLineSession(
    private val host: String,
    private val port: Int
) : LineSession {
    private var socket: Socket? = null
    private var writer: OutputStreamWriter? = null

    fun connect(timeoutMs: Int = 8_000) {
        val next = Socket()
        next.connect(InetSocketAddress(host, port), timeoutMs)
        next.soTimeout = 0
        socket = next
        writer = OutputStreamWriter(next.getOutputStream(), StandardCharsets.UTF_8)
    }

    override fun send(line: String) {
        val out = writer ?: throw IllegalStateException("not connected")
        out.write(if (line.endsWith("\n")) line else "$line\n")
        out.flush()
    }

    override fun readLines(onLine: (String) -> Unit) {
        val sock = socket ?: return
        BufferedReader(InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8)).use { reader ->
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isNotBlank()) onLine(line)
            }
        }
    }

    override fun close() {
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        socket = null
        writer = null
    }
}
