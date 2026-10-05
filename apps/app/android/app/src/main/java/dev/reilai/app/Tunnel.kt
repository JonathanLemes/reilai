package dev.reilai.app

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.min

/**
 * The app's single encrypted connection to the computer (tunnel service, direct
 * or through the relay). Every screen shares it through ReilHost.
 */
object Tunnel {
    private const val TAG = "ReilTunnel"
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val main = Handler(Looper.getMainLooper())
    private val pending = ConcurrentHashMap<Int, (JSONObject) -> Unit>()
    private var nextId = 1
    private var socket: WebSocket? = null
    private var channel: SecureChannel? = null
    private var handshake: Handshake? = null
    private var urlIndex = 0
    private var attempts = 0
    private var wanted = false
    private var appContext: Context? = null
    private var pairToken: String? = null
    private var pairCallback: ((Boolean, String?) -> Unit)? = null
    private var retry: Runnable? = null

    @Volatile var state: String = "offline"
        private set
    var machineName: String = ""
        private set

    /** Events for the screens: (name, payload). */
    var onEvent: ((String, Map<String, Any?>) -> Unit)? = null

    fun start(context: Context) {
        appContext = context.applicationContext
        val pairing = PairingStore.pairing(context) ?: return
        machineName = pairing.machineName
        wanted = true
        if (socket == null) connect()
    }

    fun stop() {
        wanted = false
        retry?.let(main::removeCallbacks)
        retry = null
        socket?.close(1000, "bye")
        socket = null
        channel = null
        setState("offline")
    }

    /** First connection with a pairing link: trust that machine key and present the one-time token. */
    fun pair(context: Context, link: PairingLink, done: (Boolean, String?) -> Unit) {
        stop()
        appContext = context.applicationContext
        PairingStore.save(context, link)
        machineName = link.name
        pairToken = link.token
        pairCallback = done
        urlIndex = 0
        attempts = 0
        wanted = true
        connect()
    }

    fun retryNow() {
        if (!wanted || state == "connected") return
        retry?.let(main::removeCallbacks)
        retry = null
        attempts = 0
        if (socket == null) connect()
    }

    private fun setState(next: String) {
        if (state == next) return
        state = next
        main.post { onEvent?.invoke("reil:connection", mapOf("state" to next, "machine" to machineName)) }
    }

    private fun connect() {
        val context = appContext ?: return
        val pairing = PairingStore.pairing(context) ?: return
        if (pairing.urls.isEmpty()) return
        val url = pairing.urls[urlIndex % pairing.urls.size]
        setState("connecting")
        val hs = Handshake(PairingStore.deviceKey(context))
        handshake = hs
        channel = null
        Log.i(TAG, "connecting to $url")
        socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(hs.hello().toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    handleFrame(webSocket, pairing, text)
                } catch (e: Exception) {
                    Log.e(TAG, "protocol error", e)
                    webSocket.close(4002, "protocol error")
                    failPairing(e.message ?: "protocol error")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "connection failed: ${t.message}")
                dropped(webSocket, t.message)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                dropped(webSocket, reason)
            }
        })
    }

    private fun handleFrame(ws: WebSocket, pairing: Pairing, text: String) {
        val current = channel
        if (current == null) {
            val ch = handshake!!.finish(JSONObject(text), pairing.machineKey)
            channel = ch
            val auth = JSONObject().put("t", "auth").put("name", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
            pairToken?.let { auth.put("pair", it) }
            ws.send(ch.seal(auth))
            return
        }
        val frame = current.open(text)
        when (frame.optString("t")) {
            "ready" -> {
                attempts = 0
                machineName = frame.optString("machine", machineName)
                pairToken = null
                setState("connected")
                pairCallback?.let { cb -> main.post { cb(true, null) } }
                pairCallback = null
            }
            "denied" -> failPairing(frame.optString("reason", "denied"))
            "event" -> {
                val payload = mapOf("event" to frame.optString("event"), "data" to Json.toNative(frame.opt("data")))
                main.post { onEvent?.invoke("reil:event", payload) }
            }
            "res" -> pending.remove(frame.optInt("id"))?.let { cb -> main.post { cb(frame) } }
        }
    }

    private fun failPairing(reason: String) {
        val cb = pairCallback ?: return
        pairCallback = null
        wanted = false
        main.post { cb(false, reason) }
    }

    private fun dropped(ws: WebSocket, reason: String?) {
        if (socket !== ws) return
        socket = null
        channel = null
        for ((_, cb) in pending) main.post { cb(JSONObject().put("error", JSONObject().put("code", "offline").put("message", "Connection lost"))) }
        pending.clear()
        setState("offline")
        if (pairCallback != null) {
            val urls = appContext?.let { PairingStore.pairing(it)?.urls } ?: emptyList()
            if (urlIndex + 1 < urls.size) {
                urlIndex += 1
                connect()
            } else failPairing(reason ?: "could not reach the computer")
            return
        }
        if (!wanted) return
        urlIndex += 1
        val delay = min(1000L shl attempts.coerceAtMost(4), 15_000L)
        attempts += 1
        retry = Runnable { retry = null; if (wanted && socket == null) connect() }
        main.postDelayed(retry!!, delay)
    }

    fun rpc(method: String, params: JSONObject, done: (JSONObject) -> Unit) {
        val ch = channel
        val ws = socket
        if (ch == null || ws == null || state != "connected") {
            done(JSONObject().put("error", JSONObject().put("code", "offline").put("message", "Not connected to the computer")))
            return
        }
        val id = synchronized(this) { nextId++ }
        pending[id] = done
        ws.send(ch.seal(JSONObject().put("t", "rpc").put("id", id).put("method", method).put("params", params)))
    }
}
