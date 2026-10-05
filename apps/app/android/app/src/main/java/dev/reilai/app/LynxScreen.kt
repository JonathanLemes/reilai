package dev.reilai.app

import android.content.Context
import android.view.View
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.xelement.XElementBehaviors
import org.json.JSONObject
import java.util.Locale

/** One Lynx screen (`<bundle>.lynx.bundle`) with the host data every screen expects. */
class LynxScreen(val screen: String, val view: LynxView, val hidesTabs: Boolean) {
    companion object {
        fun create(context: Context, bundle: String, data: Map<String, Any?>, hidesTabs: Boolean, appearance: Appearance): LynxScreen {
            val builder = LynxViewBuilder().apply {
                setTemplateProvider(AssetTemplateProvider(context.applicationContext))
                addBehaviors(XElementBehaviors().create())
            }
            val view = builder.build(context)
            view.id = View.generateViewId()
            view.setBackgroundColor(appearance.background)
            val locale = Locale.getDefault()
            val initial = data.toMutableMap().apply {
                put("platform", "android")
                put("layout", "mobile")
                put("safeTop", 0)
                put("safeBottom", 0)
                put("theme", appearance.asInitData())
                put("lang", if (locale.language == "pt") "pt" else "en")
                put("systemLocale", locale.toLanguageTag())
                put("connection", Tunnel.state)
                put("machine", Tunnel.machineName)
                put("appVersion", "${BuildConfigCompat.versionName(context)} (android)")
            }
            view.renderTemplateUrl("$bundle.lynx.bundle", JSONObject(initial).toString())
            return LynxScreen(bundle, view, hidesTabs)
        }
    }
}

object BuildConfigCompat {
    fun versionName(context: Context): String =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "0.0.0"
}
