package dev.reilai.app

import android.app.Application
import com.facebook.drawee.backends.pipeline.Fresco
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter

class ReilApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Fresco.initialize(this)
        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
        LynxServiceCenter.inst().registerService(LynxLogService)
        LynxServiceCenter.inst().registerService(LynxHttpService)
        LynxEnv.inst().init(this, null, AssetTemplateProvider(this), null)
        LynxEnv.inst().registerModule("ReilHost", ReilHost::class.java)
    }
}
