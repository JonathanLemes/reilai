package dev.reilai.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/** Native implementation of the `ReilHost` module (web twin: apps/web/src/shell/lynx.ts). */
class ReilHost(context: Context) : LynxModule(context) {
    private val appContext = context.applicationContext
    private val host: MainActivity? get() = MainActivity.current()

    @LynxMethod
    fun rpc(method: String, params: ReadableMap?, callback: Callback) {
        Tunnel.rpc(method, Json.fromMap(params?.toHashMap())) { frame ->
            val error = frame.optJSONObject("error")
            val result = if (error != null) {
                mapOf("ok" to false, "error" to mapOf("code" to error.optString("code"), "message" to error.optString("message")))
            } else mapOf("ok" to true, "result" to Json.toNative(frame.opt("result")))
            callback.invoke(Json.toLynx(result))
        }
    }

    @LynxMethod
    fun push(screen: String, params: ReadableMap?) { host?.push(screen, params?.toHashMap().orEmpty()) }

    @LynxMethod
    fun pop() { host?.pop() }

    @LynxMethod
    fun present(screen: String, params: ReadableMap?) { host?.present(screen, params?.toHashMap().orEmpty()) }

    @LynxMethod
    fun dismiss() { host?.dismissModal() }

    @LynxMethod
    fun selectTab(tab: String) { host?.selectTab(tab) }

    @LynxMethod
    fun setTheme(pref: String) { host?.setThemePref(pref) }

    @LynxMethod
    fun kvGet(key: String, callback: Callback) {
        callback.invoke(appContext.getSharedPreferences("reilai_kv", Context.MODE_PRIVATE).getString(key, null))
    }

    @LynxMethod
    fun kvSet(key: String, value: String?) {
        val edit = appContext.getSharedPreferences("reilai_kv", Context.MODE_PRIVATE).edit()
        if (value == null) edit.remove(key) else edit.putString(key, value)
        edit.apply()
    }

    @LynxMethod
    fun copyText(text: String) {
        val clipboard = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("ReilAI", text))
    }

    @LynxMethod
    fun openURL(url: String) {
        if (!url.startsWith("https://") && !url.startsWith("http://")) return
        runCatching { appContext.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    @LynxMethod
    fun haptic(style: String?) {
        val vibrator = appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        val ms = if (style == "heavy") 30L else 12L
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @LynxMethod
    fun pair(link: String, callback: Callback) {
        val parsed = try { PairingLink.parse(link) } catch (e: Exception) {
            callback.invoke(JavaOnlyMap.from(mapOf("ok" to false, "error" to (e.message ?: "invalid link"))))
            return
        }
        Tunnel.pair(appContext, parsed) { ok, error ->
            callback.invoke(JavaOnlyMap.from(mapOf("ok" to ok, "error" to error)))
            if (ok) host?.showTabs()
            else PairingStore.clear(appContext)
        }
    }

    @LynxMethod
    fun unpair() {
        Tunnel.stop()
        PairingStore.clear(appContext)
        host?.showPairGate(null)
    }

    @LynxMethod
    fun connectionState(callback: Callback) {
        callback.invoke(JavaOnlyMap.from(mapOf("state" to Tunnel.state, "machine" to Tunnel.machineName)))
    }
}
