package expo.modules.poshardware

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Bluetooth receipt printers over classic SPP (the serial-port profile nearly every portable
 * ESC/POS printer speaks). The printer is paired in Android's Bluetooth settings; a job is raw
 * ESC/POS bytes written to an RFCOMM socket, one job at a time. The socket stays open for a few
 * seconds after a job so a receipt and its KOT share one connection, and closing late also gives
 * the printer time to take the whole buffer before we hang up.
 *
 * Callers check BLUETOOTH_CONNECT first on Android 12+; older Androids grant it at install.
 */
@SuppressLint("MissingPermission")
class BluetoothPrinter {
  private val worker = Executors.newSingleThreadScheduledExecutor()
  // connect() can't be timed out from the thread it blocks, so a second thread closes it.
  private val watchdog = Executors.newSingleThreadScheduledExecutor()
  private var socket: BluetoothSocket? = null
  private var socketAddress: String? = null
  private var idleClose: ScheduledFuture<*>? = null

  private class SendFailed(val sent: Int, cause: IOException) : IOException(cause.message, cause)

  @Suppress("DEPRECATION")
  private val adapter: BluetoothAdapter?
    get() = BluetoothAdapter.getDefaultAdapter()

  fun state(): Map<String, Any> = mapOf("supported" to (adapter != null), "enabled" to (adapter?.isEnabled == true))

  /** Paired devices with what's needed to tell a printer from earbuds. */
  fun bonded(): List<Map<String, Any?>> {
    val a = adapter ?: return emptyList()
    if (!a.isEnabled) return emptyList()
    return a.bondedDevices.map { d ->
      mapOf(
        "address" to d.address,
        "name" to (d.name ?: d.address),
        "majorClass" to (d.bluetoothClass?.majorDeviceClass ?: -1),
        "spp" to (d.uuids?.any { it.uuid == SPP } ?: false),
      )
    }
  }

  fun print(address: String, bytes: ByteArray, done: (Throwable?) -> Unit) {
    worker.execute {
      idleClose?.cancel(false)
      try {
        val reused = socket?.isConnected == true && socketAddress == address
        try {
          write(open(address), bytes)
        } catch (e: SendFailed) {
          close()
          // A kept-open link the printer has since dropped (switched off, asleep): connect
          // again, but only if nothing went out, so a receipt is never half-printed twice.
          if (!reused || e.sent > 0) throw e
          write(open(address), bytes)
        }
        done(null)
      } catch (e: Throwable) {
        close()
        done(e)
      } finally {
        idleClose = worker.schedule({ close() }, IDLE_MS, TimeUnit.MILLISECONDS)
      }
    }
  }

  private fun open(address: String): BluetoothSocket {
    socket?.let { if (it.isConnected && socketAddress == address) return it }
    close()
    val a = adapter ?: throw IllegalStateException("This machine has no Bluetooth")
    if (!a.isEnabled) throw IllegalStateException("Bluetooth is off. Turn it on in Android settings.")
    val device = a.getRemoteDevice(address)
    val name = device.name ?: address
    if (device.bondState != BluetoothDevice.BOND_BONDED) throw IllegalStateException("$name isn't paired any more. Pair it again in Bluetooth settings.")
    a.cancelDiscovery()
    // Secure SPP first; some cheap printers only accept an insecure link or a fixed channel 1.
    val makers = listOf<() -> BluetoothSocket>(
      { device.createRfcommSocketToServiceRecord(SPP) },
      { device.createInsecureRfcommSocketToServiceRecord(SPP) },
      { device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(device, 1) as BluetoothSocket },
    )
    val deadline = System.currentTimeMillis() + CONNECT_BUDGET_MS
    for (make in makers) {
      if (System.currentTimeMillis() > deadline) break
      val s = try {
        make()
      } catch (_: Exception) {
        continue
      }
      val timeout = watchdog.schedule({ quietly { s.close() } }, CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      try {
        s.connect()
        timeout.cancel(false)
        socket = s
        socketAddress = address
        return s
      } catch (_: IOException) {
        timeout.cancel(false)
        quietly { s.close() }
      }
    }
    throw IllegalStateException("Couldn't reach $name. Check it's switched on, has paper and is near this machine.")
  }

  /** Small paced chunks (~20 KB/s, about what a 58 mm head prints): portable printers have tiny buffers. */
  private fun write(s: BluetoothSocket, bytes: ByteArray) {
    val out = s.outputStream
    var off = 0
    while (off < bytes.size) {
      val n = minOf(CHUNK, bytes.size - off)
      try {
        out.write(bytes, off, n)
        out.flush()
      } catch (e: IOException) {
        throw SendFailed(off, e)
      }
      off += n
      if (off < bytes.size) Thread.sleep(PACE_MS)
    }
  }

  private fun close() {
    socket?.let { quietly { it.close() } }
    socket = null
    socketAddress = null
  }

  private inline fun quietly(block: () -> Unit) {
    try {
      block()
    } catch (_: Exception) {
    }
  }

  companion object {
    /** The Serial Port Profile. */
    val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private const val CHUNK = 512
    private const val PACE_MS = 25L
    private const val IDLE_MS = 8_000L
    private const val CONNECT_TIMEOUT_MS = 8_000L
    private const val CONNECT_BUDGET_MS = 14_000L
  }
}
