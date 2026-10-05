package dev.reilai.app

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.lang.ref.WeakReference

/**
 * Native shell: a Material bottom navigation (native TabBar) over one stack of
 * Lynx screens per tab, the same model as the Clube do Patriota Android host.
 * Until a computer is paired, only the `pair` screen is shown.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        private var currentActivity = WeakReference<MainActivity>(null)
        fun current(): MainActivity? = currentActivity.get()
    }

    private val tabs = listOf("sessions", "new", "settings")
    private val stacks = mutableMapOf<String, MutableList<LynxScreen>>()
    private val allViews = linkedSetOf<LynxView>()
    private lateinit var root: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var tabBar: BottomNavigationView
    private lateinit var appearance: Appearance
    private var currentTab = "sessions"
    private var gate: LynxScreen? = null
    private var modal: BottomSheetDialog? = null
    private var tabsReady = false

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = pop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.AppTheme)
        super.onCreate(savedInstanceState)
        currentActivity = WeakReference(this)
        appearance = Appearance(this)
        onBackPressedDispatcher.addCallback(this, backCallback)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        buildLayout()
        Tunnel.onEvent = { name, payload -> sendEvent(name, payload) }
        val link = intent?.data?.toString()?.takeIf { it.startsWith("reilai://pair") }
        if (PairingStore.pairing(this) == null || link != null) showPairGate(link) else {
            Tunnel.start(this)
            showTabs()
        }
    }

    private fun buildLayout() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content = FrameLayout(this)
        tabBar = BottomNavigationView(this).apply {
            inflateMenu(R.menu.main_tabs)
            labelVisibilityMode = BottomNavigationView.LABEL_VISIBILITY_LABELED
            setOnItemSelectedListener { item -> selectTab(tabFor(item.itemId)); true }
            setOnItemReselectedListener { popToRoot() }
            ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets -> v.setPadding(0, 0, 0, 0); insets }
        }
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(tabBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        // edge-to-edge: status bar on top, keyboard or navigation bar at the bottom
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        applyAppearance()
    }

    private fun tabFor(id: Int) = when (id) {
        R.id.tab_new -> "new"
        R.id.tab_settings -> "settings"
        else -> "sessions"
    }

    private fun idFor(tab: String) = when (tab) {
        "new" -> R.id.tab_new
        "settings" -> R.id.tab_settings
        else -> R.id.tab_sessions
    }

    private fun applyAppearance() {
        root.setBackgroundColor(appearance.background)
        content.setBackgroundColor(appearance.background)
        tabBar.setBackgroundColor(appearance.surface)
        tabBar.itemIconTintList = appearance.tabColors
        tabBar.itemTextColor = appearance.tabColors
        tabBar.itemActiveIndicatorColor = ColorStateList.valueOf(appearance.color("primary-soft"))
        allViews.forEach { it.setBackgroundColor(appearance.background) }
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = appearance.isLight
            isAppearanceLightNavigationBars = appearance.isLight
        }
    }

    // ------------------------------------------------------------------ gate / tabs

    fun showPairGate(link: String?) {
        runOnUiThread {
            destroyAll()
            tabBar.isVisible = false
            val screen = createScreen("pair", if (link != null) mapOf("link" to link) else emptyMap(), true)
            gate = screen
            content.addView(screen.view, matchParent())
        }
    }

    fun showTabs() {
        runOnUiThread {
            destroyAll()
            tabBar.isVisible = true
            tabsReady = true
            selectTab("sessions")
        }
    }

    private fun destroyAll() {
        modal?.dismiss()
        modal = null
        gate = null
        tabsReady = false
        allViews.forEach { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        allViews.clear()
        stacks.clear()
        content.removeAllViews()
    }

    private fun createScreen(bundle: String, data: Map<String, Any?>, hidesTabs: Boolean): LynxScreen =
        LynxScreen.create(this, bundle, data, hidesTabs, appearance).also { allViews.add(it.view) }

    // ------------------------------------------------------------------ navigation (ReilHost)

    fun selectTab(tab: String) {
        runOnUiThread {
            if (tab !in tabs || !tabsReady) return@runOnUiThread
            // tabs are created on first visit: a lighter start (one Lynx runtime instead of three)
            if (stacks[tab] == null) {
                val params: Map<String, Any?> = if (tab == "new") mapOf("asTab" to true) else emptyMap()
                val screen = createScreen(tab, params, false)
                stacks[tab] = mutableListOf(screen)
                content.addView(screen.view, matchParent())
            }
            currentTab = tab
            if (tabBar.selectedItemId != idFor(tab)) tabBar.selectedItemId = idFor(tab)
            for ((name, stack) in stacks) stack.forEachIndexed { i, s -> s.view.isVisible = name == tab && i == stack.lastIndex }
            updateChrome()
        }
    }

    fun push(screen: String, params: Map<String, Any?>) {
        runOnUiThread {
            val stack = stacks[currentTab] ?: return@runOnUiThread
            val next = createScreen(screen, params, true)
            content.addView(next.view, matchParent())
            next.view.translationX = content.width.toFloat()
            next.view.animate().translationX(0f).setDuration(260).withEndAction {
                stack.forEach { if (it !== next) it.view.isVisible = false }
            }.start()
            stack.add(next)
            updateChrome()
        }
    }

    fun pop() {
        runOnUiThread {
            val stack = stacks[currentTab] ?: return@runOnUiThread
            if (stack.size <= 1) return@runOnUiThread
            val top = stack.removeAt(stack.lastIndex)
            stack.last().view.isVisible = true
            top.view.animate().translationX(content.width.toFloat()).setDuration(220).withEndAction {
                content.removeView(top.view)
                allViews.remove(top.view)
                top.view.destroy()
            }.start()
            updateChrome()
        }
    }

    private fun popToRoot() {
        val stack = stacks[currentTab] ?: return
        while (stack.size > 1) {
            val top = stack.removeAt(stack.lastIndex)
            content.removeView(top.view)
            allViews.remove(top.view)
            top.view.destroy()
        }
        stack.firstOrNull()?.view?.isVisible = true
        updateChrome()
    }

    fun present(screen: String, params: Map<String, Any?>) {
        runOnUiThread {
            modal?.dismiss()
            val sheetScreen = createScreen(screen, params, true)
            val dialog = BottomSheetDialog(this)
            val height = (resources.displayMetrics.heightPixels * 0.94).toInt()
            dialog.setContentView(sheetScreen.view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height))
            dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED
            dialog.behavior.skipCollapsed = true
            dialog.setOnDismissListener {
                if (modal === dialog) modal = null
                allViews.remove(sheetScreen.view)
                sheetScreen.view.destroy()
            }
            modal = dialog
            dialog.show()
        }
    }

    fun dismissModal() {
        runOnUiThread { modal?.dismiss() }
    }

    private fun updateChrome() {
        val stack = stacks[currentTab]
        backCallback.isEnabled = (stack?.size ?: 0) > 1
        tabBar.isVisible = tabsReady && stack?.lastOrNull()?.hidesTabs != true
    }

    // ------------------------------------------------------------------ events & theme

    fun sendEvent(name: String, payload: Map<String, Any?>) {
        runOnUiThread {
            val args = JavaOnlyArray.of(Json.toLynx(payload))
            allViews.forEach { it.sendGlobalEvent(name, args) }
        }
    }

    fun setThemePref(pref: String) {
        runOnUiThread {
            Appearance.save(this, pref)
            appearance = Appearance(this)
            applyAppearance()
            sendEvent("reil:theme", appearance.asInitData())
        }
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        val before = appearance.effective
        appearance = Appearance(this)
        if (before != appearance.effective) {
            applyAppearance()
            sendEvent("reil:theme", appearance.asInitData())
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val link = intent.data?.toString() ?: return
        if (link.startsWith("reilai://pair")) showPairGate(link)
    }

    override fun onResume() {
        super.onResume()
        Tunnel.retryNow()
    }

    override fun onDestroy() {
        allViews.forEach(LynxView::destroy)
        allViews.clear()
        if (currentActivity.get() === this) currentActivity.clear()
        super.onDestroy()
    }

    private fun matchParent() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
}
