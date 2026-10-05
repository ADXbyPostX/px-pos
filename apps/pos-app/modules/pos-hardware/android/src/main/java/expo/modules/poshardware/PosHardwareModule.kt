package expo.modules.poshardware

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
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
      withPermission(device) { granted ->
        if (!granted) {
          promise.reject("E_USB_DENIED", "Permission to use the printer was refused", null)
          return@withPermission
        }
        jobs.execute {
          // No paper check: the drawer must open even when the printer is out of paper.
          try {
            send(device, DRAWER_PULSE)
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
      withPermission(device) { granted ->
        if (!granted) {
          promise.reject("E_USB_DENIED", "Permission to use the printer was refused", null)
          return@withPermission
        }
        jobs.execute {
          try {
            val st = status(device)
            when {
              st["coverOpen"] == true -> throw IllegalStateException("The printer cover is open. Close it until it clicks.")
              st["paperOut"] == true -> throw IllegalStateException("The printer is out of paper (or the roll is in the wrong way round).")
            }
            send(device, bytes)
            promise.resolve(null)
          } catch (e: Exception) {
            promise.reject("E_PRINT", e.message ?: "Printing failed", e)
          }
        }
      }
    }
  }

  /** Prefer the board's own printer (Aclas, 0x6778) over anything plugged into a USB socket. */
  private fun firstPrinter(): UsbDevice? {
    val printers = usb.deviceList.values.filter { printerPort(it) != null }
    return printers.firstOrNull { it.vendorId == 0x6778 } ?: printers.firstOrNull()
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
    val conn = usb.openDevice(device) ?: throw IllegalStateException("Could not open the printer")
    try {
      if (!conn.claimInterface(intf, true)) throw IllegalStateException("The printer is busy")
      var off = 0
      while (off < bytes.size) {
        // The offset overload of bulkTransfer needs API 28; the TP-482C runs API 27.
        val chunk = bytes.copyOfRange(off, minOf(off + CHUNK, bytes.size))
        val n = conn.bulkTransfer(out, chunk, chunk.size, TIMEOUT_MS)
        if (n <= 0) throw IllegalStateException("The printer stopped responding (out of paper or lid open?)")
        off += n
      }
      conn.releaseInterface(intf)
    } finally {
      conn.close()
    }
  }

  companion object {
    /**
     * Aclas board drawer kick (from its driver): pulse drawer pin 0 — ESC q 0 60 255 — then
     * ESC C 0. Sent through the printer's bulk pipe; works with or without paper.
     */
    private val DRAWER_PULSE = byteArrayOf(0x1b, 0x71, 0x00, 0x3c, 0xff.toByte(), 0x1b, 0x43, 0x00, 0x00, 0x00)
    private const val CHUNK = 4096
    private const val TIMEOUT_MS = 5000
  }
}
