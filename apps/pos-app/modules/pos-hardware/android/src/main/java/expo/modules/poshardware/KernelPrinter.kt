package expo.modules.poshardware

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import java.io.File
import java.io.FileDescriptor

/**
 * The printer through the board's own kernel driver (`/dev/usblp0`), the way Aclas's software
 * prints on the TVS TP-482C. Its driver runs a print thread (`aclas_print_thr`) that feeds the
 * mechanism at its own pace. Raw USB bulk writes bypass it: the board then drops whatever arrives
 * while it's busy (a logo ate a different part of every bill), and claiming the USB interface
 * detaches the driver until the next reboot. So once this node opens, nothing claims the
 * interface again.
 */
class KernelPrinter(private val path: String = "/dev/usblp0") {
  /** The node exists and the driver is attached (open fails with EBUSY after a raw USB claim). */
  fun usable(): Boolean {
    if (!File(path).exists()) return false
    return try {
      Os.close(Os.open(path, OsConstants.O_RDWR, 0))
      true
    } catch (_: ErrnoException) {
      false
    }
  }

  /**
   * Write the job; with `pieces` (each image band on its own, see PosHardwareModule.pieces) an image
   * band is followed by a short pause, as Aclas's own driver sends one 24-line band per write.
   */
  fun write(bytes: ByteArray, pieces: List<Pair<Int, Int>> = listOf(0 to bytes.size)) {
    val fd = Os.open(path, OsConstants.O_RDWR, 0)
    try {
      for ((from, to) in pieces) {
        var off = from
        while (off < to) {
          val n = Os.write(fd, bytes, off, minOf(CHUNK, to - off))
          if (n <= 0) throw IllegalStateException("The printer stopped taking data (out of paper or lid open?)")
          off += n
        }
        if (to < bytes.size && isBand(bytes, from)) Thread.sleep(BAND_PAUSE_MS)
      }
    } finally {
      Os.close(fd)
    }
  }

  /**
   * Write without waiting (the drawer kick): a driver that's holding back because its printer
   * reports no paper (Tea Room's first TP-482C) would otherwise block the job queue for good.
   * False = it couldn't take the bytes now.
   */
  fun writeNow(bytes: ByteArray): Boolean {
    val fd = try {
      Os.open(path, OsConstants.O_RDWR or OsConstants.O_NONBLOCK, 0)
    } catch (_: ErrnoException) {
      return false
    }
    return try {
      Os.write(fd, bytes, 0, bytes.size) == bytes.size
    } catch (_: ErrnoException) {
      false
    } finally {
      Os.close(fd)
    }
  }

  private fun isBand(b: ByteArray, i: Int) = i + 3 < b.size && b[i] == 0x1d.toByte() && b[i + 1] == 0x76.toByte() && b[i + 2] == 0x30.toByte() && b[i + 3] == 0x00.toByte()

  /** ESC/POS real-time status (DLE EOT n); same meaning as the raw USB path's status. */
  fun status(): Map<String, Any?> {
    val fd = Os.open(path, OsConstants.O_RDWR, 0)
    try {
      val buf = ByteArray(16)
      while (readable(fd, 20)) if (Os.read(fd, buf, 0, buf.size) <= 0) break // drop stale replies
      fun ask(n: Int): Int? {
        Os.write(fd, byteArrayOf(0x10, 0x04, n.toByte()), 0, 3)
        if (!readable(fd, 800)) return null
        val got = Os.read(fd, buf, 0, buf.size)
        return if (got > 0) buf[got - 1].toInt() and 0xff else null
      }
      val printer = ask(1)
      val offline = ask(2)
      val roll = ask(4)
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
      Os.close(fd)
    }
  }

  private fun readable(fd: FileDescriptor, timeoutMs: Int): Boolean {
    val p = StructPollfd().apply {
      this.fd = fd
      events = OsConstants.POLLIN.toShort()
    }
    return try {
      Os.poll(arrayOf(p), timeoutMs) > 0 && (p.revents.toInt() and OsConstants.POLLIN) != 0
    } catch (_: ErrnoException) {
      false
    }
  }

  companion object {
    private const val CHUNK = 4096
    private const val BAND_PAUSE_MS = 80L
  }
}
