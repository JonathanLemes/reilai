package dev.reilai.app

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import org.json.JSONObject

/** Theme preference (system/light/dark) and the palette generated from @reilai/brand. */
class Appearance(context: Context) {
    private val prefs = context.getSharedPreferences("reilai_appearance", Context.MODE_PRIVATE)
    val pref: String = prefs.getString("pref", "system") ?: "system"
    val effective: String = when (pref) {
        "light", "dark" -> pref
        else -> if (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }
    private val palette = JSONObject(context.assets.open("theme.json").bufferedReader().use { it.readText() }).getJSONObject(effective)

    val isLight get() = effective == "light"
    fun color(name: String): Int = Color.parseColor(palette.getString(name))
    val background get() = color("bg")
    val surface get() = color("surface")

    val tabColors: ColorStateList
        get() = ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(color("primary"), color("text-tertiary")),
        )

    fun asInitData(): Map<String, Any> = mapOf("pref" to pref, "effective" to effective)

    companion object {
        fun save(context: Context, pref: String) {
            context.getSharedPreferences("reilai_appearance", Context.MODE_PRIVATE).edit().putString("pref", pref).apply()
        }
    }
}
