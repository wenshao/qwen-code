package com.qwen.mobileshell

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import android.webkit.WebChromeClient.FileChooserParams
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

// Verification probe only (not proposed for commit): wall time of result() for N granted URIs on the main thread.
@RunWith(AndroidJUnit4::class)
class PickerTimingProbe {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private class Params : FileChooserParams() {
        override fun getMode() = MODE_OPEN_MULTIPLE
        override fun getAcceptTypes() = emptyArray<String>()
        override fun isCaptureEnabled() = false
        override fun getTitle(): CharSequence? = null
        override fun getFilenameHint(): String? = null
        override fun createIntent() = Intent()
    }

    @Test fun timeResultForGrantedSelections() {
        context.contentResolver.call(FilePickerFixtureProvider.BASE_URI, "reset", null, null)
        val uris = (0..99).map { i ->
            context.contentResolver.call(FilePickerFixtureProvider.BASE_URI, "grant", i.toString(), null)
            FilePickerFixtureProvider.uri(i)
        }
        for (n in listOf(1, 10, 100)) {
            val samples = mutableListOf<Double>()
            repeat(15) {
                val intent = Intent().addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply {
                    clipData = ClipData.newRawUri("probe", uris[0]).also { c -> uris.subList(1, n).forEach { c.addItem(ClipData.Item(it)) } }
                }
                var got: Array<Uri>? = null
                var ms = 0.0
                instrumentation.runOnMainSync {
                    val picker = NativeFilePicker(context) { }
                    picker.open(Params(), { true }) { got = it }
                    val t0 = SystemClock.elapsedRealtimeNanos()
                    picker.result(Activity.RESULT_OK, intent)
                    ms = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6
                }
                assertEquals(n, got!!.size)
                samples.add(ms)
            }
            val s = samples.drop(3).sorted()
            Log.i("PickerTimingProbe", "n=$n median=%.2fms p90=%.2fms max=%.2fms".format(s[s.size / 2], s[(s.size * 9) / 10], s.last()))
        }
        context.contentResolver.call(FilePickerFixtureProvider.BASE_URI, "reset", null, null)
    }
}
