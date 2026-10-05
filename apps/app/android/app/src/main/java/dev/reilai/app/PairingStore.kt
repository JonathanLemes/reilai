package dev.reilai.app

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray

/** Who we are (device key) and which computer we trust (machine key + URLs), in encrypted prefs. */
data class Pairing(val machineKey: String, val machineName: String, val urls: List<String>)

data class PairingLink(val machineKey: String, val token: String, val urls: List<String>, val name: String) {
    companion object {
        fun parse(link: String): PairingLink {
            val uri = Uri.parse(link.trim())
            if (uri.scheme != "reilai" || uri.host != "pair") throw IllegalArgumentException("not a reilai://pair link")
            val key = uri.getQueryParameter("k") ?: throw IllegalArgumentException("missing machine key")
            val token = uri.getQueryParameter("t") ?: throw IllegalArgumentException("missing pairing token")
            val urls = uri.getQueryParameters("u").filter { it.startsWith("ws://") || it.startsWith("wss://") }
            if (urls.isEmpty()) throw IllegalArgumentException("no tunnel address in the link")
            return PairingLink(key, token, urls, uri.getQueryParameter("n") ?: "computer")
        }
    }
}

object PairingStore {
    private var prefs: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences = prefs ?: run {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context,
            "reilai_pairing",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ).also { prefs = it }
    }

    /** Long-term device identity, created on first use. */
    fun deviceKey(context: Context): KeyPair {
        val p = prefs(context)
        val pub = p.getString("device.pub", null)
        val priv = p.getString("device.priv", null)
        if (pub != null && priv != null) return KeyPair(B64.dec(pub), B64.dec(priv))
        val created = KeyPair.generate()
        p.edit().putString("device.pub", B64.enc(created.publicKey)).putString("device.priv", B64.enc(created.privateKey)).apply()
        return created
    }

    fun pairing(context: Context): Pairing? {
        val p = prefs(context)
        val key = p.getString("machine.key", null) ?: return null
        val urls = JSONArray(p.getString("machine.urls", "[]"))
        return Pairing(key, p.getString("machine.name", "") ?: "", (0 until urls.length()).map { urls.getString(it) })
    }

    fun save(context: Context, link: PairingLink) {
        prefs(context).edit()
            .putString("machine.key", link.machineKey)
            .putString("machine.name", link.name)
            .putString("machine.urls", JSONArray(link.urls).toString())
            .apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().remove("machine.key").remove("machine.name").remove("machine.urls").apply()
    }
}
