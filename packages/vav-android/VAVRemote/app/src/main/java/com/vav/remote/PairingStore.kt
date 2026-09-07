package com.vav.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Device-local pairing book. iOS keeps the same list in the Keychain. */
class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("vav.remote.pairing", Context.MODE_PRIVATE)

    fun load(): PairingBook {
        val raw = prefs.getString("book", null) ?: return PairingBook()
        return try {
            val obj = JSONObject(raw)
            val rows = obj.optJSONArray("pairings") ?: JSONArray()
            val pairings = buildList {
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    add(
                        Pairing(
                            uri = row.optString("uri"),
                            host = row.optString("host"),
                            port = row.optInt("port"),
                            secret = row.optString("secret"),
                            name = row.optString("name"),
                            remoteToken = row.optString("remoteToken").ifBlank { null }
                        )
                    )
                }
            }
            PairingBook(pairings, obj.optString("activeToken").ifBlank { pairings.firstOrNull()?.token })
        } catch (_: Exception) {
            PairingBook()
        }
    }

    fun save(book: PairingBook) {
        val rows = JSONArray()
        for (pairing in book.pairings) {
            rows.put(
                JSONObject()
                    .put("uri", pairing.uri)
                    .put("host", pairing.host)
                    .put("port", pairing.port)
                    .put("secret", pairing.secret)
                    .put("name", pairing.name)
                    .put("remoteToken", pairing.remoteToken ?: "")
            )
        }
        prefs.edit()
            .putString(
                "book",
                JSONObject()
                    .put("pairings", rows)
                    .put("activeToken", book.activeToken ?: "")
                    .toString()
            )
            .apply()
    }
}

data class PairingBook(
    val pairings: List<Pairing> = emptyList(),
    val activeToken: String? = null
) {
    val active: Pairing? get() = pairings.firstOrNull { it.token == activeToken } ?: pairings.firstOrNull()

    fun upsert(pairing: Pairing): PairingBook {
        val next = listOf(pairing) + pairings.filter { it.token != pairing.token }
        return copy(pairings = next, activeToken = pairing.token)
    }

    fun forget(token: String): PairingBook {
        val next = pairings.filter { it.token != token }
        val active = if (activeToken == token) next.firstOrNull()?.token else activeToken
        return copy(pairings = next, activeToken = active)
    }

    fun activate(token: String): PairingBook = copy(activeToken = token)
}
