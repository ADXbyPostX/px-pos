package expo.modules.poshardware

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import android.text.TextPaint
import android.text.TextUtils
import android.util.Log
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.Executors

/**
 * The customer-facing 132×65 dot-matrix LCD on the TVS TP-482C (an Aclas AOBX board).
 *
 * It hangs off the printer board's HID interface (USB 6778:0112, /dev/hidrawN). Every command
 * is a frame `20 00 1F len | 0A cmd data… | ~xor 03` written as one HID output report whose id
 * (0x50…0x58) encodes the frame size; the board acks each frame with an input report whose
 * third byte is 0x1F. Pictures are 1-bit raster ("GS v 0"), 13 rows per frame, top to bottom.
 *
 * Updates are coalesced: only the newest picture is sent, and an unchanged picture isn't resent.
 */
class CustomerDisplay {
  data class Line(val text: String, val right: String?, val size: Float, val bold: Boolean, val center: Boolean, val rule: Boolean)

  /** A picture: optional QR modules ("1" = dark, one string per row) on the left, text beside it. */
  data class Frame(val lines: List<Line>, val qr: List<String>? = null)

  private val worker = Executors.newSingleThreadExecutor()
  private val lock = Any()
  private var pending: Frame? = null
  private var draining = false
  private var port: HidPort? = null
  private var lastRaster: ByteArray? = null

  @Volatile var lastError: String? = null
    private set

  @Volatile private var node: File? = null

  /** The display's hidraw node: the Aclas board's HID interface 1 when it can be told apart. */
  fun find(): File? {
    node?.let { if (it.exists()) return it }
    return scan().also { node = it }
  }

  private fun scan(): File? {
    val nodes = File("/sys/class/hidraw").listFiles()?.sortedBy { it.name } ?: return null
    val ours = nodes.filter { n ->
      runCatching { File(n, "device/uevent").readText() }.getOrDefault("").contains("HID_ID=0003:0000$VENDOR:0000$PRODUCT", ignoreCase = true)
    }
    // …/2-1.2:1.1/0003:6778:0112.0001 → the parent is the USB interface.
    val preferred = ours.firstOrNull { runCatching { File(it, "device").canonicalFile.parentFile?.name?.endsWith(":1.1") }.getOrNull() == true } ?: ours.firstOrNull()
    return preferred?.let { File("/dev/${it.name}") }?.takeIf { it.exists() }
  }

  /** Queue a picture made of these lines. Returns false when there's no display on this machine. */
  fun show(frame: Frame): Boolean {
    if (find() == null) return false
    synchronized(lock) {
      pending = frame
      if (draining) return true
      draining = true
    }
    worker.execute { drain() }
    return true
  }

  /** Send a test picture now (not coalesced) and report how many frames the display acknowledged. */
  fun test(lines: List<Line>, done: (Map<String, Any?>) -> Unit) {
    worker.execute {
      val (sent, acked) = try {
        sendRaster(render(Frame(lines)), force = true)
      } catch (e: Exception) {
        fail(e)
        0 to 0
      }
      done(mapOf("path" to port?.path, "sent" to sent, "acked" to acked, "error" to lastError))
    }
  }

  private fun drain() {
    while (true) {
      val frame = synchronized(lock) {
        val f = pending
        pending = null
        if (f == null) draining = false
        f
      } ?: return
      try {
        sendRaster(render(frame), force = false)
      } catch (e: Exception) {
        fail(e)
      }
    }
  }

  private fun sendRaster(raster: ByteArray, force: Boolean): Pair<Int, Int> {
    if (!force && lastRaster?.contentEquals(raster) == true) return 0 to 0
    val p = open() ?: return 0 to 0
    var sent = 0
    var acked = 0
    try {
      var y = 0
      while (y < HEIGHT) {
        val rows = minOf(CHUNK_ROWS, HEIGHT - y)
        val data = ByteArray(8 + rows * BPR)
        // "GS v 0" raster header: width in bytes, then rows (the board reads both big-endian).
        byteArrayOf(0x1d, 0x76, 0x30, (BPR shr 8).toByte(), BPR.toByte(), (rows shr 8).toByte(), rows.toByte(), 0).copyInto(data)
        System.arraycopy(raster, y * BPR, data, 8, rows * BPR)
        sent++
        if (p.command(CMD_DATA, data)) acked++
        y += rows
      }
      lastRaster = if (acked == sent) raster else null
      lastError = if (acked == sent) null else "The customer display acknowledged $acked of $sent parts"
    } catch (e: Exception) {
      fail(e)
    }
    return sent to acked
  }

  private fun open(): HidPort? {
    port?.let { return it }
    val path = find() ?: run {
      lastError = "No customer display found"
      return null
    }
    return try {
      HidPort(path).also {
        it.handshake()
        it.command(CMD_BACKLIGHT_ON)
        it.command(CMD_CLEAR)
        port = it
        lastRaster = null
      }
    } catch (e: Exception) {
      fail(e)
      null
    }
  }

  private fun fail(e: Exception) {
    Log.w(TAG, "customer display: ${e.message}")
    lastError = e.message ?: e.javaClass.simpleName
    runCatching { port?.close() }
    port = null
    node = null // re-scan: the board may have re-enumerated
    lastRaster = null
  }

  // ─── drawing ──────────────────────────────────────────────────────────────

  /**
   * Draw the QR (if any) at the largest whole-dot scale that fits with a one-module margin, then
   * lay the lines out top to bottom beside it, centred vertically; pack 1 bit per pixel.
   */
  fun render(frame: Frame): ByteArray {
    val lines = frame.lines
    val bmp = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.drawColor(Color.WHITE)
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }

    var x0 = PAD
    val qr = frame.qr
    if (!qr.isNullOrEmpty()) {
      val n = qr.size
      val scale = maxOf(1, HEIGHT / (n + 2))
      val side = (n + 2) * scale
      val top = (HEIGHT - side) / 2
      val dot = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }
      for (r in 0 until n) {
        val row = qr[r]
        for (col in 0 until minOf(n, row.length)) {
          if (row[col] != '1') continue
          val x = (col + 1) * scale
          val y = top + (r + 1) * scale
          c.drawRect(x.toFloat(), y.toFloat(), (x + scale).toFloat(), (y + scale).toFloat(), dot)
        }
      }
      x0 = side + 3
    }
    val avail = (WIDTH - PAD - x0).toFloat()

    fun style(l: Line) {
      paint.typeface = if (l.bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
      paint.textSize = l.size
      // A single centred line shrinks to fit before it's cut short.
      if (l.right == null) while (paint.textSize > MIN_TEXT && paint.measureText(l.text) > avail) paint.textSize -= 1f
    }
    fun height(l: Line): Float {
      if (l.rule) return RULE_H
      style(l)
      val fm = paint.fontMetrics
      return fm.descent - fm.ascent
    }

    val total = lines.sumOf { height(it).toDouble() }.toFloat() + GAP * (lines.size - 1).coerceAtLeast(0)
    var y = maxOf(0f, (HEIGHT - total) / 2f)
    for (l in lines) {
      if (l.rule) {
        paint.strokeWidth = 1f
        c.drawLine(x0.toFloat(), y + 1f, (WIDTH - PAD).toFloat(), y + 1f, paint)
        y += RULE_H + GAP
        continue
      }
      style(l)
      val fm = paint.fontMetrics
      val base = y - fm.ascent
      if (l.right != null) {
        val rw = paint.measureText(l.right)
        c.drawText(l.right, WIDTH - PAD - rw, base, paint)
        val left = TextUtils.ellipsize(l.text, paint, maxOf(0f, avail - rw - 4f), TextUtils.TruncateAt.END).toString()
        c.drawText(left, x0.toFloat(), base, paint)
      } else {
        val t = TextUtils.ellipsize(l.text, paint, avail, TextUtils.TruncateAt.END).toString()
        val x = if (l.center) x0 + (avail - paint.measureText(t)) / 2f else x0.toFloat()
        c.drawText(t, x, base, paint)
      }
      y += fm.descent - fm.ascent + GAP
    }

    val px = IntArray(WIDTH * HEIGHT)
    bmp.getPixels(px, 0, WIDTH, 0, 0, WIDTH, HEIGHT)
    bmp.recycle()
    val out = ByteArray(BPR * HEIGHT)
    for (row in 0 until HEIGHT) {
      for (col in 0 until WIDTH) {
        val v = px[row * WIDTH + col]
        val lum = (Color.red(v) * 299 + Color.green(v) * 587 + Color.blue(v) * 114) / 1000
        if (lum < 150) out[row * BPR + col / 8] = (out[row * BPR + col / 8].toInt() or (0x80 ushr (col % 8))).toByte()
      }
    }
    return out
  }

  // ─── transport ────────────────────────────────────────────────────────────

  private class HidPort(file: File) : Closeable {
    val path: String = file.path
    private val raf = RandomAccessFile(file, "rw")
    private val buf = ByteArray(512)

    /** The board's "ACLAS" hello, as Aclas's own driver sends it before using the display. */
    fun handshake() {
      write(frame(0x00, 0x38, "ACLAS".toByteArray()))
      awaitReply(REPLY_MS)
      write(frame(0x01, 0x38, byteArrayOf(3, 5, 1, 4, 12, 4, 3, 4, 1, 4)))
      awaitReply(REPLY_MS)
    }

    fun command(cmd: Int, data: ByteArray = ByteArray(0)): Boolean {
      val payload = ByteArray(2 + data.size)
      payload[0] = DEV_CD10.toByte()
      payload[1] = cmd.toByte()
      data.copyInto(payload, 2)
      drainReplies()
      write(frame(0x00, 0x1f, payload))
      val n = awaitReply(REPLY_MS)
      return n >= 3 && (buf[2].toInt() and 0xff) == 0x1f
    }

    private fun write(f: ByteArray) {
      val report = ByteArray(f.size + 1)
      report[0] = reportId(f.size).toByte()
      f.copyInto(report, 1)
      raf.write(report)
    }

    private fun ready(ms: Int): Boolean {
      val pfd = StructPollfd().apply {
        fd = raf.fd
        events = OsConstants.POLLIN.toShort()
      }
      return Os.poll(arrayOf(pfd), ms) > 0 && (pfd.revents.toInt() and OsConstants.POLLIN) != 0
    }

    private fun awaitReply(ms: Int): Int = if (ready(ms)) raf.read(buf) else 0

    private fun drainReplies() {
      while (ready(0)) raf.read(buf)
    }

    override fun close() = raf.close()

    companion object {
      /** `20 a b len data… ~xor 03` — xor over a, b, len and the data. */
      fun frame(a: Int, b: Int, data: ByteArray): ByteArray {
        require(data.size <= 0xff - 6) { "display frame too long" }
        val f = ByteArray(data.size + 6)
        f[0] = 0x20
        f[1] = a.toByte()
        f[2] = b.toByte()
        f[3] = data.size.toByte()
        data.copyInto(f, 4)
        var x = 0
        for (i in 1 until 4 + data.size) x = x xor (f[i].toInt() and 0xff)
        f[4 + data.size] = (x.inv() and 0xff).toByte()
        f[5 + data.size] = 0x03
        return f
      }

      /** Output report ids 0x50…0x57 hold 8…64 bytes in steps of 8; 0x58 holds 248. */
      fun reportId(len: Int): Int = when {
        len > 0xf8 -> throw IllegalArgumentException("display frame too long")
        len > 0x40 -> 0x58
        else -> 0x50 + maxOf(0, (len - 1) / 8)
      }
    }
  }

  companion object {
    const val WIDTH = 132
    const val HEIGHT = 65
    private const val BPR = (WIDTH + 7) / 8
    private const val CHUNK_ROWS = 232 / BPR
    private const val VENDOR = "6778"
    private const val PRODUCT = "0112"
    private const val DEV_CD10 = 0x0a
    private const val CMD_BACKLIGHT_ON = 0x01
    private const val CMD_CLEAR = 0x02
    private const val CMD_DATA = 0xff
    private const val REPLY_MS = 300
    private const val PAD = 2
    private const val GAP = 2f
    private const val RULE_H = 3f
    private const val MIN_TEXT = 10f
    private const val TAG = "PxPosHardware"
  }
}
