package dev.reilai.app

import android.util.Base64
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Kotlin mirror of packages/crypto (spec in docs/security.md):
 * X25519 (ephemeral + static) → HKDF-SHA256 → AES-256-GCM with counter nonces.
 */
object B64 {
    private const val FLAGS = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
    fun enc(bytes: ByteArray): String = Base64.encodeToString(bytes, FLAGS)
    fun dec(text: String): ByteArray = Base64.decode(text, FLAGS)
}

class KeyPair(val publicKey: ByteArray, val privateKey: ByteArray) {
    companion object {
        fun generate(): KeyPair {
            val priv = X25519.generatePrivateKey()
            return KeyPair(X25519.publicFromPrivate(priv), priv)
        }
    }
}

class SecureChannel(
    private val sendKey: ByteArray,
    private val recvKey: ByteArray,
    private val sendLabel: String,
    private val recvLabel: String,
) {
    private var sendCounter = 0L
    private var recvCounter = 0L

    private fun nonce(counter: Long): ByteArray = ByteBuffer.allocate(12).putInt(0).putLong(counter).array()

    @Synchronized
    fun seal(value: JSONObject): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sendKey, "AES"), GCMParameterSpec(128, nonce(sendCounter)))
        cipher.updateAAD(sendLabel.toByteArray())
        val body = cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        val frame = JSONObject().put("n", sendCounter).put("c", B64.enc(body)).toString()
        sendCounter += 1
        return frame
    }

    @Synchronized
    fun open(frame: String): JSONObject {
        val parsed = JSONObject(frame)
        val n = parsed.getLong("n")
        if (n != recvCounter) throw SecurityException("unexpected frame counter (replay or reorder)")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(recvKey, "AES"), GCMParameterSpec(128, nonce(recvCounter)))
        cipher.updateAAD(recvLabel.toByteArray())
        val plain = cipher.doFinal(B64.dec(parsed.getString("c")))
        recvCounter += 1
        return JSONObject(String(plain, Charsets.UTF_8))
    }
}

/** Device side of the handshake. */
class Handshake(private val device: KeyPair) {
    private val ephemeral = KeyPair.generate()

    fun hello(): JSONObject = JSONObject()
        .put("t", "hello")
        .put("v", 1)
        .put("dpk", B64.enc(device.publicKey))
        .put("epk", B64.enc(ephemeral.publicKey))

    fun finish(reply: JSONObject, expectedMachineKey: String?): SecureChannel {
        if (reply.optInt("v") != 1) throw SecurityException("unsupported channel version")
        val mpk = reply.getString("mpk")
        if (expectedMachineKey != null && mpk != expectedMachineKey) throw SecurityException("machine key mismatch")
        val machine = B64.dec(mpk)
        val serverEphemeral = B64.dec(reply.getString("epk"))
        val ikm = X25519.computeSharedSecret(ephemeral.privateKey, serverEphemeral) +
            X25519.computeSharedSecret(ephemeral.privateKey, machine) +
            X25519.computeSharedSecret(device.privateKey, machine)
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update("reilai-v1".toByteArray())
        digest.update(device.publicKey)
        digest.update(ephemeral.publicKey)
        digest.update(machine)
        digest.update(serverEphemeral)
        val okm = Hkdf.computeHkdf("HMACSHA256", ikm, digest.digest(), "reilai/v1/keys".toByteArray(), 64)
        return SecureChannel(okm.copyOfRange(0, 32), okm.copyOfRange(32, 64), "c2s", "s2c")
    }
}
