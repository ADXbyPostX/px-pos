package expo.modules.poshardware

import java.util.concurrent.locks.ReentrantLock

/**
 * The TP-482C's printer, cash drawer and customer display all hang off one Aclas board. Traffic
 * that overlaps — a "Thank you" picture or a drawer kick arriving while a bill (above all its logo)
 * is still printing — makes the board drop part of the bill. So they take turns: whoever talks to
 * the board holds this lock, and a print holds it until the paper has stopped moving.
 */
object Board {
  val lock = ReentrantLock(true)

  /** Rough time the mechanism needs for these ESC/POS bytes: text lines, image rows and the cut. */
  fun printMs(b: ByteArray): Long {
    var lines = 0
    var rows = 0
    var i = 0
    while (i < b.size) {
      if (i + 7 < b.size && b[i] == 0x1d.toByte() && b[i + 1] == 0x76.toByte() && b[i + 2] == 0x30.toByte() && b[i + 3] == 0x00.toByte()) {
        val w = (b[i + 4].toInt() and 0xff) or ((b[i + 5].toInt() and 0xff) shl 8)
        val h = (b[i + 6].toInt() and 0xff) or ((b[i + 7].toInt() and 0xff) shl 8)
        rows += h
        i += 8 + w * h
        continue
      }
      if (b[i] == 0x0a.toByte()) lines++
      i++
    }
    return BASE_MS + lines * LINE_MS + rows * ROW_MS
  }

  private const val BASE_MS = 400L // start + cut
  private const val LINE_MS = 90L // a 24-dot text line plus spacing at a cautious 40 mm/s
  private const val ROW_MS = 4L // one dot row of an image
}
