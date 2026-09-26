package com.qwen.mobileshell

import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Round-2 verification probe for #12129 (not part of the PR). Logs under tag QV12129R2.
 * Seeds through the PR's own EmptyProfileFixture, so it refuses non-empty installs exactly like the committed tests.
 * Args: -e orient land|port, -e shot <name> (screenshot saved to the app cache dir).
 */
@RunWith(AndroidJUnit4::class)
class ProbeR2Test {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()
    private lateinit var store: AndroidProfileStore
    private val fixture = EmptyProfileFixture()
    private val alpha = ConnectionProfile.create("Accessibility Alpha", "https://alpha.example", "synthetic-token")
    private val beta = ConnectionProfile.create("Accessibility Beta", "https://beta.example", null)

    private fun vaultFile() = File(context.noBackupFilesDir, "connection-profiles.v1")

    @Test fun dumpVault() {
        val s = AndroidProfileStore(context)
        val line = try {
            val state = s.vault.load()
            "profiles=${state.profiles.size} retiredBrowsers=${state.retiredBrowsers.size} fileBytes=${vaultFile().takeIf { it.exists() }?.length()}"
        } catch (e: Exception) { "unreadable: ${e.javaClass.simpleName}: ${e.message}" }
        Log.i(TAG, "VAULT $line")
    }

    /** Plants pre-existing data of one kind (-e kind real|legacy|garbage|bak) on an empty install. */
    @Test fun plant() {
        when (args.getString("kind")) {
            "real" -> AndroidProfileStore(context).vault.save(ProfileState(listOf(ConnectionProfile.create("Real Device", "https://real.example", "real-secret"))))
            "legacy" -> context.getSharedPreferences("qwen_profiles", Context.MODE_PRIVATE).edit()
                .putString("daemon_url", "https://legacy.example").putString("daemon_token", "legacy-secret").commit()
            "garbage" -> vaultFile().writeBytes(byteArrayOf(9, 9, 9, 9, 9, 9, 9, 9))
            "bak" -> File(vaultFile().path + ".bak").writeBytes(byteArrayOf(7, 7, 7, 7))
        }
        Log.i(TAG, "PLANTED ${args.getString("kind")}")
    }

    private fun seed() {
        assumeTrue("interrupted write", !File(vaultFile().path + ".bak").exists() && !File(vaultFile().path + ".new").exists())
        store = AndroidProfileStore(context)
        fixture.seed(store.vault, listOf(alpha, beta), context.getSharedPreferences("qwen_profiles", Context.MODE_PRIVATE).all.isNotEmpty()) {
            vaultFile().takeIf { it.exists() }?.readBytes()
        }
    }

    @After fun restore() {
        fixture.restore { bytes ->
            val file = android.util.AtomicFile(vaultFile())
            if (bytes == null) file.delete() else {
                val out = file.startWrite(); out.write(bytes); file.finishWrite(out)
            }
        }
    }

    /** First Save with an invalid origin while the address field holds input focus. */
    @Test fun editorError() {
        seed()
        val live = CopyOnWriteArrayList<String>()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            if (args.getString("orient") == "land") {
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                SystemClock.sleep(1500)
            }
            click(R.string.edit)
            val address = find { it.isEditable && it.hintText?.toString() == context.getString(R.string.daemon_address) }
            address.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            setText(address, "invalid-origin")
            instrumentation.waitForIdleSync()
            val before = focusedHint()
            instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
                if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                    val source = event.source
                    if (source != null && source.liveRegion != 0) live.add("live=${source.liveRegion} text=${source.text}")
                }
            }
            if (args.getString("tap") == "touch") {
                // Real touch through the input pipeline (stays in touch mode, like a sighted user's tap).
                val save = find { it.isVisibleToUser && it.isClickable && it.text?.toString()?.equals(context.getString(R.string.save), true) == true }
                val r = Rect().also { save.getBoundsInScreen(it) }
                instrumentation.uiAutomation.executeShellCommand("input tap ${r.centerX()} ${r.centerY()}").close()
            } else click(R.string.save)
            SystemClock.sleep(1500)
            instrumentation.waitForIdleSync()
            instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
            val root = instrumentation.uiAutomation.rootInActiveWindow
            val error = walk(root).firstOrNull { it.text?.toString() == context.getString(R.string.changed_origin_credential) }
            val bounds = Rect().also { r -> error?.getBoundsInScreen(r) }
            val window = Rect().also { r -> root?.getBoundsInScreen(r) }
            val ime = instrumentation.uiAutomation.executeShellCommand("dumpsys input_method").let { pfd ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().readText()
            }.lineSequence().firstOrNull { it.contains("mInputShown=") || it.contains("isInputViewShown") }?.trim()
            Log.i(TAG, "EDITOR tap=${args.getString("tap") ?: "a11y"} orient=${args.getString("orient")} font=${context.resources.configuration.fontScale} dpi=${context.resources.configuration.densityDpi} " +
                "errorVisibleToUser=${error?.isVisibleToUser} errorBounds=$bounds window=$window liveEvents=${live.size} ${live.distinct()} " +
                "focusBefore=$before focusAfter=${focusedHint()} ime=$ime")
            shot()
        }
    }

    /** Round-1 live-region steps, rerun at the new head. */
    @Test fun liveEvents() {
        seed()
        val live = CopyOnWriteArrayList<String>()
        ActivityScenario.launch(MainActivity::class.java).use {
            click(R.string.edit)
            find { it.isEditable }
            instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
                if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                    val source = event.source
                    if (source != null && source.liveRegion != 0) live.add("live=${source.liveRegion} text=${source.text}")
                }
            }
            fun step(label: String, action: () -> Unit) {
                live.clear(); action(); SystemClock.sleep(1500); instrumentation.waitForIdleSync()
                Log.i(TAG, "LIVE $label | events=${live.size} ${live.distinct()}")
            }
            val address = { find { it.isEditable && it.hintText?.toString() == context.getString(R.string.daemon_address) } }
            val name = { find { it.isEditable && it.hintText?.toString() == context.getString(R.string.profile_name) } }
            step("1 invalid-origin") { setText(address(), "invalid-origin"); click(R.string.save) }
            step("2 same input again") { click(R.string.save) }
            step("3 ftp://x (same message)") { setText(address(), "ftp://x"); click(R.string.save) }
            step("4 empty name (new message)") { setText(name(), ""); click(R.string.save) }
            instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
        }
    }

    /** Storage recovery page: is the ScrollView scrollable, and where is Reset, in the current configuration? */
    @Test fun recoveryPage() {
        seed()
        vaultFile().writeBytes(byteArrayOf(1, 2, 3))
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            if (args.getString("orient") == "land") {
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                SystemClock.sleep(1500)
            }
            val hint = find { it.text?.toString() == context.getString(R.string.storage_unavailable_hint) }
            instrumentation.waitForIdleSync()
            val root = instrumentation.uiAutomation.rootInActiveWindow
            val scrolls = walk(root).filter { it.className?.toString() == "android.widget.ScrollView" }
                .map { "ScrollView(scrollable=${it.isScrollable} bounds=${Rect().also { r -> it.getBoundsInScreen(r) }})" }.toList()
            val reset = walk(root).firstOrNull { it.text?.toString()?.equals(context.getString(R.string.reset_profiles), true) == true }
            val window = Rect().also { r -> root?.getBoundsInScreen(r) }
            Log.i(TAG, "RECOVERY orient=${args.getString("orient")} font=${context.resources.configuration.fontScale} dpi=${context.resources.configuration.densityDpi} " +
                "window=$window scrollViews=$scrolls reset(visible=${reset?.isVisibleToUser} bounds=${Rect().also { r -> reset?.getBoundsInScreen(r) }}) hintLive=${hint.liveRegion}")
            if (args.getString("swipe") != null) {
                // Real finger swipes up the middle of the page, then re-measure Reset.
                repeat(4) {
                    instrumentation.uiAutomation.executeShellCommand(
                        "input swipe ${window.centerX()} ${window.top + window.height() * 3 / 4} ${window.centerX()} ${window.top + window.height() / 4} 300").close()
                    SystemClock.sleep(700)
                }
                instrumentation.waitForIdleSync()
                val after = walk(instrumentation.uiAutomation.rootInActiveWindow)
                    .firstOrNull { it.text?.toString()?.equals(context.getString(R.string.reset_profiles), true) == true }
                Log.i(TAG, "RECOVERY-AFTER-SWIPE reset(visible=${after?.isVisibleToUser} bounds=${Rect().also { r -> after?.getBoundsInScreen(r) }})")
            }
            shot()
        }
    }

    private fun shot() {
        val name = args.getString("shot") ?: return
        SystemClock.sleep(300)
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        File(context.cacheDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        Log.i(TAG, "SHOT $name ${bitmap.width}x${bitmap.height}")
    }

    private fun focusedHint(): String? =
        walk(instrumentation.uiAutomation.rootInActiveWindow).firstOrNull { it.isFocused }?.let { "${it.className}:${it.hintText ?: it.text}" }

    private fun click(resource: Int) {
        val label = context.getString(resource)
        repeat(6) {
            instrumentation.waitForIdleSync()
            val root = instrumentation.uiAutomation.rootInActiveWindow
            walk(root).firstOrNull { it.isVisibleToUser && it.isClickable && it.text?.toString()?.equals(label, true) == true }
                ?.let { it.performAction(AccessibilityNodeInfo.ACTION_CLICK); return }
            walk(root).firstOrNull { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            SystemClock.sleep(150)
        }
        find { it.isClickable && it.text?.toString()?.equals(label, true) == true }.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun setText(node: AccessibilityNodeInfo, text: String) {
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        })
    }

    private fun find(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + 5_000
        do {
            instrumentation.waitForIdleSync()
            val root = instrumentation.uiAutomation.rootInActiveWindow
            if (root?.packageName == context.packageName) walk(root).firstOrNull(predicate)?.let { return it }
            SystemClock.sleep(50)
        } while (SystemClock.uptimeMillis() < deadline)
        throw AssertionError("probe node not found")
    }

    private fun walk(node: AccessibilityNodeInfo?): Sequence<AccessibilityNodeInfo> = sequence {
        if (node == null) return@sequence
        yield(node)
        for (index in 0 until node.childCount) node.getChild(index)?.let { yieldAll(walk(it)) }
    }

    companion object { private const val TAG = "QV12129R2" }
}
