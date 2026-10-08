package expo.modules.poshardware

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executors

/** One line on the customer display (see CustomerDisplay.Line). */
class DisplayLineRecord : Record {
  @Field val text: String = ""
  @Field val right: String? = null
  @Field val size: Double = 14.0
  @Field val bold: Boolean = true
  @Field val center: Boolean = false
  @Field val rule: Boolean = false

  fun toLine() = CustomerDisplay.Line(text, right, size.toFloat(), bold, center, rule)
}

/**
 * POS hardware on the terminal itself: a USB receipt printer (any device exposing a
 * USB printer-class interface, e.g. the Aclas board inside the TVS TP-482C) fed raw
 * ESC/POS bytes, the cash drawer (a pulse sent through that printer) and the board's
 * customer display (CustomerDisplay). Bluetooth printers paired with the machine go through
 * BluetoothPrinter. Printer jobs run one at a time on a background thread.
 */
class PosHardwareModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val usb: UsbManager
    get() = context.getSystemService(Context.USB_SERVICE) as UsbManager
  private val jobs = Executors.newSingleThreadExecutor()
  // PIN checks get their own thread so a sign-in never waits behind a print job.
  private val crypto = Executors.newSingleThreadExecutor()
  private val display = CustomerDisplay()
  private val bluetooth = BluetoothPrinter()
  private val kernel = KernelPrinter()

  override fun definition() = ModuleDefinition {
    Name("PosHardware")

    Function("listUsbPrinters") {
      usb.deviceList.values.filter { printerPort(it) != null }.map { d ->
        mapOf(
          "deviceName" to d.deviceName,
          "vendorId" to d.vendorId,
          "productId" to d.productId,
          "manufacturer" to (d.manufacturerName ?: ""),
          "product" to (d.productName ?: ""),
          "hasPermission" to usb.hasPermission(d),
        )
      }
    }

    AsyncFunction("usbPrinterStatus") { promise: Promise ->
      val device = firstPrinter()
      if (device == null) {
        promise.reject("E_NO_PRINTER", "No USB printer is connected", null)
        return@AsyncFunction
      }
      if (viaDriver(device)) {
        jobs.execute {
          try {
            promise.resolve(kernel.status())
          } catch (e: Exception) {
            promise.reject("E_STATUS", e.message ?: "Could not read the printer status", e)
          }
        }
        return@AsyncFunction
      }
      withPermission(device) { granted ->
        if (!granted) {
          promise.reject("E_USB_DENIED", "Permission to use the printer was refused", null)
          return@withPermission
        }
        jobs.execute {
          try {
            promise.resolve(status(device))
          } catch (e: Exception) {
            promise.reject("E_STATUS", e.message ?: "Could not read the printer status", e)
          }
        }
      }
    }

    /** PBKDF2-HMAC-SHA256, 32-byte key, base64 in and out: the till PIN hash (see PinHash). */
    AsyncFunction("pbkdf2Sha256") { password: String, saltB64: String, iterations: Int, promise: Promise ->
      crypto.execute {
        try {
          val key = PinHash.pbkdf2Sha256(password.toByteArray(Charsets.UTF_8), Base64.decode(saltB64, Base64.DEFAULT), iterations)
          promise.resolve(Base64.encodeToString(key, Base64.NO_WRAP))
        } catch (e: Exception) {
          promise.reject("E_PIN_HASH", e.message ?: "Couldn't check the PIN", e)
        }
      }
    }

    AsyncFunction("openCashDrawer") { promise: Promise ->
      val device = firstPrinter()
      if (device == null) {
        promise.reject("E_NO_PRINTER", "No printer board to open the drawer with", null)
        return@AsyncFunction
      }
      // Through the driver when it takes the pulse at once; a driver holding back (its printer says
      // no paper) gets the direct USB path instead, which needs no paper.
      if (viaDriver(device)) {
        jobs.execute {
          try {
            var ok = false
            onBoard(DRAWER_SETTLE_MS) {
              ok = kernel.writeNow(DRAWER_PULSE)
              if (!ok && usb.hasPermission(device)) {
                send(device, DRAWER_PULSE)
                ok = true
              }
            }
            if (ok) promise.resolve(null) else promise.reject("E_DRAWER", "Couldn't open the cash drawer", null)
          } catch (e: Exception) {
            promise.reject("E_DRAWER", e.message ?: "Couldn't open the cash drawer", e)
          }
        }
        return@AsyncFunction
      }
      withPermission(device) { granted ->
        if (!granted) {
          promise.reject("E_USB_DENIED", "Permission to use the printer was refused", null)
          return@withPermission
        }
        jobs.execute {
          // No paper check: the drawer must open even when the printer is out of paper.
          try {
            onBoard(DRAWER_SETTLE_MS) { send(device, DRAWER_PULSE) }
            promise.resolve(null)
          } catch (e: Exception) {
            promise.reject("E_DRAWER", e.message ?: "Couldn't open the cash drawer", e)
          }
        }
      }
    }

    Function("customerDisplayInfo") {
      val node = display.find()
      mapOf("available" to (node != null), "path" to node?.path, "width" to CustomerDisplay.WIDTH, "height" to CustomerDisplay.HEIGHT, "lastError" to display.lastError)
    }

    Function("customerDisplayShow") { lines: List<DisplayLineRecord> ->
      display.show(CustomerDisplay.Frame(lines.map { it.toLine() }))
    }

    Function("customerDisplayShowQr") { qr: List<String>, lines: List<DisplayLineRecord> ->
      display.show(CustomerDisplay.Frame(lines.map { it.toLine() }, qr))
    }

    AsyncFunction("customerDisplayTest") { lines: List<DisplayLineRecord>, promise: Promise ->
      if (display.find() == null) {
        promise.reject("E_NO_DISPLAY", "No customer display found on this machine", null)
        return@AsyncFunction
      }
      display.test(lines.map { it.toLine() }) { promise.resolve(it) }
    }

    Function("bluetoothState") { bluetooth.state() }

    Function("listBluetoothDevices") { bluetooth.bonded() }

    AsyncFunction("printBluetooth") { address: String, bytes: ByteArray, promise: Promise ->
      bluetooth.print(address, bytes) { e ->
        when (e) {
          null -> promise.resolve(null)
          is SecurityException -> promise.reject("E_BT_DENIED", "Allow PX POS to use Nearby devices (Android settings › Apps › PX POS › Permissions)", e)
          else -> promise.reject("E_BT_PRINT", e.message ?: "Bluetooth printing failed", e)
        }
      }
    }

    AsyncFunction("printUsb") { bytes: ByteArray, promise: Promise ->
      val device = firstPrinter()
      if (device == null) {
        promise.reject("E_NO_PRINTER", "No USB printer is connected", null)
        return@AsyncFunction
      }
      if (viaDriver(device)) {
        jobs.execute {
          try {
            onBoard(Board.printMs(bytes)) {
              checkReady(kernel.status())
              kernel.write(bytes, pieces(bytes))
            }
            promise.resolve(null)
          } catch (e: Exception) {
            promise.reject("E_PRINT", e.message ?: "Printing failed", e)
          }
        }
        return@AsyncFunction
      }
      withPermission(device) { granted ->
        if (!granted) {
          promise.reject("E_USB_DENIED", "Permission to use the printer was refused", null)
          return@withPermission
        }
        jobs.execute {
          try {
            onBoard(Board.printMs(bytes)) {
              checkReady(status(device))
              send(device, bytes)
            }
            promise.resolve(null)
          } catch (e: Exception) {
            promise.reject("E_PRINT", e.message ?: "Printing failed", e)
          }
        }
      }
    }
  }

  private fun checkReady(st: Map<String, Any?>) {
    when {
      st["coverOpen"] == true -> throw IllegalStateException("The printer cover is open. Close it until it clicks.")
      st["paperOut"] == true -> throw IllegalStateException("The printer is out of paper (or the roll is in the wrong way round).")
    }
  }

  /** Talk to the board alone, and keep it until the mechanism is done (see Board). */
  private fun onBoard(holdMs: Long, block: () -> Unit) {
    Board.lock.lock()
    try {
      val start = System.currentTimeMillis()
      block()
      val left = holdMs - (System.currentTimeMillis() - start)
      if (left > 0) Thread.sleep(left)
    } finally {
      Board.lock.unlock()
    }
  }

  /**
   * The Aclas board's printer goes through its kernel driver whenever that's attached (see
   * KernelPrinter); raw USB stays for other printers, and for a board whose driver a previous
   * build detached (until the machine restarts).
   */
  private fun viaDriver(device: UsbDevice): Boolean {
    if (device.vendorId != ACLAS) return false
    val ok = kernel.usable()
    if (!ok) Log.i(TAG, "Aclas printer driver not attached (restart the machine); using raw USB")
    return ok
  }

  /** Prefer the board's own printer (Aclas, 0x6778) over anything plugged into a USB socket. */
  private fun firstPrinter(): UsbDevice? {
    val printers = usb.deviceList.values.filter { printerPort(it) != null }
    return printers.firstOrNull { it.vendorId == ACLAS } ?: printers.firstOrNull()
  }

  private fun printerPort(d: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
    for (i in 0 until d.interfaceCount) {
      val intf = d.getInterface(i)
      if (intf.interfaceClass != UsbConstants.USB_CLASS_PRINTER) continue
      for (e in 0 until intf.endpointCount) {
        val ep = intf.getEndpoint(e)
        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) return intf to ep
      }
    }
    return null
  }

  private fun printerIn(intf: UsbInterface): UsbEndpoint? {
    for (e in 0 until intf.endpointCount) {
      val ep = intf.getEndpoint(e)
      if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_IN) return ep
    }
    return null
  }

  /**
   * ESC/POS real-time status (DLE EOT n). Bits per Epson: n=2 offline cause (bit 2 cover open,
   * bit 5 paper end stop, bit 6 error); n=4 roll sensor (bits 5-6 paper end). A printer that
   * doesn't answer reports "unknown" and printing goes ahead.
   */
  private fun status(device: UsbDevice): Map<String, Any?> {
    val (intf, out) = printerPort(device) ?: throw IllegalStateException("That USB device is not a printer")
    val inEp = printerIn(intf)
    val conn = usb.openDevice(device) ?: throw IllegalStateException("Could not open the printer")
    try {
      if (!conn.claimInterface(intf, true)) throw IllegalStateException("The printer is busy")
      fun ask(n: Int): Int? {
        if (inEp == null) return null
        val buf = ByteArray(64)
        while (conn.bulkTransfer(inEp, buf, buf.size, 30) > 0) { /* drain stale replies */ }
        if (conn.bulkTransfer(out, byteArrayOf(0x10, 0x04, n.toByte()), 3, 1000) != 3) return null
        val got = conn.bulkTransfer(inEp, buf, buf.size, 800)
        return if (got > 0) buf[got - 1].toInt() and 0xff else null
      }
      val printer = ask(1)
      val offline = ask(2)
      val roll = ask(4)
      conn.releaseInterface(intf)
      return mapOf(
        "answered" to (printer != null || offline != null || roll != null),
        "printer" to printer,
        "offline" to offline,
        "roll" to roll,
        "coverOpen" to (offline?.let { it and 0x04 != 0 } ?: false),
        "paperOut" to ((offline?.let { it and 0x20 != 0 } ?: false) || (roll?.let { it and 0x60 == 0x60 } ?: false)),
        "error" to (offline?.let { it and 0x40 != 0 } ?: false),
      )
    } finally {
      conn.close()
    }
  }

  private fun withPermission(device: UsbDevice, done: (Boolean) -> Unit) {
    if (usb.hasPermission(device)) return done(true)
    val ctx = context
    val action = "${ctx.packageName}.USB_PERMISSION"
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        if (intent.action != action) return
        try {
          c.unregisterReceiver(this)
        } catch (_: Exception) {
        }
        done(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false))
      }
    }
    val filter = IntentFilter(action)
    if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED) else ctx.registerReceiver(receiver, filter)
    val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
    usb.requestPermission(device, PendingIntent.getBroadcast(ctx, 0, Intent(action).setPackage(ctx.packageName), flags))
  }

  private fun send(device: UsbDevice, bytes: ByteArray) {
    val (intf, out) = printerPort(device) ?: throw IllegalStateException("That USB device is not a printer")
    val inEp = printerIn(intf)
    val conn = usb.openDevice(device) ?: throw IllegalStateException("Could not open the printer")
    try {
      if (!conn.claimInterface(intf, true)) throw IllegalStateException("The printer is busy")
      // Flow control. Built-in boards like the TP-482C's Aclas take bytes faster than they print
      // and silently drop what overflows their buffer — a logo then ate a different chunk of every
      // bill. So the job goes in pieces (each logo band whole, text cut only between lines), and
      // after each piece the printer must answer GS r 1, which it does only once everything sent
      // before it has been processed. A printer that never answers gets timed pauses instead.
      for ((from, to) in pieces(bytes)) {
        var off = from
        while (off < to) {
          // The offset overload of bulkTransfer needs API 28; the TP-482C runs API 27.
          val chunk = bytes.copyOfRange(off, minOf(off + CHUNK, to))
          val n = conn.bulkTransfer(out, chunk, chunk.size, TIMEOUT_MS)
          if (n <= 0) throw IllegalStateException("The printer stopped responding (out of paper or lid open?)")
          off += n
        }
        if (to < bytes.size) waitForPrinter(conn, out, inEp, isRaster(bytes, from))
      }
      conn.releaseInterface(intf)
    } finally {
      conn.close()
    }
  }

  /** Block until the printer has worked through what it was sent (GS r 1 answered), or pause. */
  private fun waitForPrinter(conn: UsbDeviceConnection, out: UsbEndpoint, inEp: UsbEndpoint?, raster: Boolean) {
    if (inEp != null && answersSync != false) {
      val buf = ByteArray(64)
      while (conn.bulkTransfer(inEp, buf, buf.size, 10) > 0) { /* drop stale replies */ }
      if (conn.bulkTransfer(out, SYNC, SYNC.size, 1000) == SYNC.size) {
        val got = conn.bulkTransfer(inEp, buf, buf.size, if (answersSync == true) SYNC_WAIT_MS else FIRST_SYNC_MS)
        if (got > 0) {
          if (answersSync == null) Log.i(TAG, "printer answers GS r: using it for flow control")
          answersSync = true
          return
        }
      }
      if (answersSync == null) Log.i(TAG, "printer doesn't answer GS r: pacing by time")
      if (answersSync == null) answersSync = false
    }
    Thread.sleep(if (raster) BAND_PAUSE_MS else TEXT_PAUSE_MS)
  }

  private fun isRaster(b: ByteArray, i: Int) = i + 3 < b.size && b[i] == 0x1d.toByte() && b[i + 1] == 0x76.toByte() && b[i + 2] == 0x30.toByte() && b[i + 3] == 0x00.toByte()

  /**
   * The job as (from, to-exclusive) pieces: each GS v 0 band on its own (never split — a sync inside it
   * would be read as image data), text in ≤ TEXT_PIECE bytes cut only after a line feed, so a
   * multi-byte command is never split either.
   */
  private fun pieces(b: ByteArray): List<Pair<Int, Int>> {
    val out = ArrayList<Pair<Int, Int>>()
    var start = 0
    var lastBreak = -1
    var i = 0
    fun cut(at: Int) {
      if (at > start) out.add(start to at)
      start = at
      lastBreak = -1
    }
    while (i < b.size) {
      if (isRaster(b, i) && i + 7 < b.size) {
        cut(i)
        val w = (b[i + 4].toInt() and 0xff) or ((b[i + 5].toInt() and 0xff) shl 8)
        val h = (b[i + 6].toInt() and 0xff) or ((b[i + 7].toInt() and 0xff) shl 8)
        i = minOf(b.size, i + 8 + w * h)
        cut(i)
        continue
      }
      if (b[i] == 0x0a.toByte()) lastBreak = if (i + 1 < b.size && b[i + 1] == 0x0d.toByte()) i + 2 else i + 1
      i++
      if (i - start >= TEXT_PIECE && lastBreak > start) cut(lastBreak)
    }
    cut(b.size)
    return out
  }

  companion object {
    /**
     * Aclas board drawer kick (from its driver): pulse drawer pin 0 — ESC q 0 60 255 — then
     * ESC C 0. Sent through the printer's bulk pipe; works with or without paper.
     */
    private val DRAWER_PULSE = byteArrayOf(0x1b, 0x71, 0x00, 0x3c, 0xff.toByte(), 0x1b, 0x43, 0x00, 0x00, 0x00)
    private const val ACLAS = 0x6778
    /** The drawer solenoid's pulse, before anything else may use the board. */
    private const val DRAWER_SETTLE_MS = 400L
    private const val CHUNK = 4096
    /** Text piece between syncs: a few receipt lines, far below any board's buffer. */
    private const val TEXT_PIECE = 512
    /** GS r 1: transmit paper sensor status — answered in sequence, after what came before it. */
    private val SYNC = byteArrayOf(0x1d, 0x72, 0x01)
    private const val FIRST_SYNC_MS = 1500
    private const val SYNC_WAIT_MS = 5000
    /** Without GS r: a dense 24-line band can take ~0.2 s to burn; a few text lines less. */
    private const val BAND_PAUSE_MS = 250L
    private const val TEXT_PAUSE_MS = 120L
    private const val TAG = "PxPosHardware"
    /** Whether this printer answers GS r (null until the first job finds out). */
    @Volatile private var answersSync: Boolean? = null
    private const val TIMEOUT_MS = 5000
  }
}
