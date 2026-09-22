package com.qwen.mobileshell

import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Verification probe for #12129 (not part of the PR). Logs under tag QV12129. */
@RunWith(AndroidJUnit4::class)
class ProbeLiveRegionTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var store: AndroidProfileStore
    private lateinit var original: ProfileState
    private val probe = ConnectionProfile.create("Probe", "https://probe.example", null)

    @Before fun seed() {
        store = AndroidProfileStore(context)
        original = store.vault.load()
        store.vault.save(original.copy(profiles = listOf(probe)))
    }

    @After fun restore() { store.vault.save(original) }

    @Test fun probeValidationEvents() {
        val live = CopyOnWriteArrayList<String>()
        ActivityScenario.launch(MainActivity::class.java).use {
            find { it.isClickable && it.text?.toString()?.equals(context.getString(R.string.edit), true) == true }
                .performAction(AccessibilityNodeInfo.ACTION_CLICK)
            find { it.isEditable }
            instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
                if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
                    event.eventType == AccessibilityEvent.TYPE_ANNOUNCEMENT) {
                    val source = event.source
                    if (source != null && source.liveRegion != 0) {
                        live.add("type=${AccessibilityEvent.eventTypeToString(event.eventType)} changes=${event.contentChangeTypes} live=${source.liveRegion} text=${source.text}")
                    }
                }
            }
            fun step(label: String, action: () -> Unit) {
                live.clear()
                action()
                SystemClock.sleep(1500)
                instrumentation.waitForIdleSync()
                val error = walk(instrumentation.uiAutomation.rootInActiveWindow)
                    .firstOrNull { it.className == "android.widget.TextView" && it.text?.toString()?.let { t -> t.startsWith("Enter ") || t.startsWith("For a different") } == true }
                val bounds = Rect().also { r -> error?.getBoundsInScreen(r) }
                Log.i(TAG, "STEP $label | liveEvents=${live.size} ${live.distinct()} | errorText=${error?.text} visibleToUser=${error?.isVisibleToUser} bounds=$bounds")
            }
            val address = { find { it.isEditable && it.hintText?.toString() == context.getString(R.string.daemon_address) } }
            val name = { find { it.isEditable && it.hintText?.toString() == context.getString(R.string.profile_name) } }
            step("1 invalid-origin") { setText(address(), "invalid-origin"); clickText(R.string.save) }
            step("2 same input again") { clickText(R.string.save) }
            step("3 ftp://x (same message)") { setText(address(), "ftp://x"); clickText(R.string.save) }
            step("4 empty name (new message)") { setText(name(), ""); clickText(R.string.save) }
            instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
        }
    }

    private fun clickText(resource: Int) {
        find { it.isClickable && it.text?.toString()?.equals(context.getString(resource), true) == true }
            .performAction(AccessibilityNodeInfo.ACTION_CLICK)
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
        throw AssertionError("node not found")
    }

    private fun walk(node: AccessibilityNodeInfo?): Sequence<AccessibilityNodeInfo> = sequence {
        if (node == null) return@sequence
        yield(node)
        for (index in 0 until node.childCount) node.getChild(index)?.let { yieldAll(walk(it)) }
    }

    companion object { private const val TAG = "QV12129" }
}
