import TcpSocket from "react-native-tcp-socket";
import { listUsbPrinters, printBluetooth, printUsb } from "../../modules/pos-hardware";

export interface PrinterTarget {
  host: string;
  port: number;
}

/** Anything that can take ESC/POS bytes: a LAN, Bluetooth or the terminal's own USB printer. */
export interface PrinterTransport {
  send(bytes: Uint8Array): Promise<void>;
}

/** Raw TCP (port 9100) — how almost every LAN/Wi-Fi thermal printer accepts jobs. */
export function lanPrinter(target: PrinterTarget, timeoutMs = 3500): PrinterTransport {
  return {
    send(bytes) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            socket.destroy();
          } catch {
            /* already closed */
          }
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(() => done(new Error(`Printer at ${target.host}:${target.port} did not respond`)), timeoutMs);
        const socket = TcpSocket.createConnection({ host: target.host, port: target.port }, () => {
          socket.write(bytes, undefined, (err) => {
            if (err) return done(err);
            // Give the printer a moment to take the buffer before closing.
            setTimeout(() => done(), 250);
          });
        });
        socket.on("error", (e: Error) => done(e));
      });
    },
  };
}

/** The terminal's built-in (or plugged-in) USB receipt printer, e.g. inside the TVS TP-482C. */
export function builtInPrinter(): { transport: PrinterTransport; name: string } | null {
  const p = listUsbPrinters()[0];
  if (!p) return null;
  return { transport: { send: (bytes) => printUsb(bytes) }, name: p.product || p.manufacturer || "USB printer" };
}

/** A Bluetooth printer paired with this machine (Android Bluetooth settings), by its address. */
export function bluetoothPrinter(address: string): PrinterTransport {
  return { send: (bytes) => printBluetooth(address, bytes) };
}
