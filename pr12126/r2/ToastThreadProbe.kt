package com.qwen.mobileshell

import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith

// Verification probe only: does Toast.makeText throw on the instrumentation thread that runs FilePickerDeviceTest?
@RunWith(AndroidJUnit4::class)
class ToastThreadProbe {
    @Test fun toastOnTestThread() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val outcome = try { Toast.makeText(ctx, "probe", Toast.LENGTH_SHORT).show(); "shown" } catch (e: RuntimeException) { "threw ${e.javaClass.simpleName}: ${e.message}" }
        Log.i("ToastThreadProbe", "looper=${Looper.myLooper() != null} main=${Looper.myLooper() == Looper.getMainLooper()} outcome=$outcome")
    }
}
