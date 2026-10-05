package dev.reilai.app

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream

class AssetTemplateProvider(context: Context) : AbsTemplateProvider() {
    private val applicationContext = context.applicationContext

    override fun loadTemplate(uri: String, callback: Callback) {
        Thread {
            try {
                applicationContext.assets.open(uri).use { input ->
                    ByteArrayOutputStream().use { output ->
                        input.copyTo(output)
                        callback.onSuccess(output.toByteArray())
                    }
                }
            } catch (error: Exception) {
                callback.onFailed(error.message ?: "Cannot open bundle $uri")
            }
        }.start()
    }
}
