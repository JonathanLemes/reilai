package dev.reilai.app

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import org.json.JSONArray
import org.json.JSONObject

/** JSON ⇄ Kotlin ⇄ Lynx bridge values. */
object Json {
    fun toNative(value: Any?): Any? = when (value) {
        is JSONObject -> value.keys().asSequence().associateWith { toNative(value.opt(it)) }
        is JSONArray -> (0 until value.length()).map { toNative(value.opt(it)) }
        JSONObject.NULL -> null
        else -> value
    }

    fun toLynx(value: Any?): Any? = when (value) {
        is Map<*, *> -> JavaOnlyMap.from(value.entries.associate { (k, v) -> k.toString() to toLynx(v) })
        is Iterable<*> -> JavaOnlyArray.from(value.map(::toLynx))
        is JSONObject, is JSONArray -> toLynx(toNative(value))
        else -> value
    }

    fun fromMap(map: Map<String, Any?>?): JSONObject = JSONObject(map ?: emptyMap<String, Any?>())
}
