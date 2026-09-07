package com.vav.remote

/** JSON-lines pipe — LAN TCP or a tailcat tunnel, same frames as iOS `LineTransport`. */
interface LineSession {
    fun send(line: String)
    fun readLines(onLine: (String) -> Unit)
    fun close()
}
