package expo.modules.poshardware

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PBKDF2-HMAC-SHA256 with a 32-byte key (one block), for till PINs. Same algorithm as WebCrypto's
 * PBKDF2 in pos-admin, so a PIN set in the browser checks here offline. Written out with Mac
 * (available on every API level) instead of SecretKeyFactory, which needs Android 8 for SHA-256.
 */
object PinHash {
  fun pbkdf2Sha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
    require(iterations >= 1) { "iterations must be at least 1" }
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(password, "HmacSHA256"))
    // U1 = HMAC(P, S || INT(1)); Ui = HMAC(P, Ui-1); T = U1 ^ U2 ^ … ^ Uc
    mac.update(salt)
    mac.update(byteArrayOf(0, 0, 0, 1))
    var u = mac.doFinal()
    val t = u.copyOf()
    for (i in 1 until iterations) {
      u = mac.doFinal(u)
      for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
    }
    return t
  }
}
