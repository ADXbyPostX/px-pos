import { requireOptionalNativeModule } from "expo";

export interface UsbPrinterInfo {
  deviceName: string;
  vendorId: number;
  productId: number;
  manufacturer: string;
  product: string;
  hasPermission: boolean;
}

/** Raw ESC/POS status bytes (null = the printer didn't answer) and what they mean. */
export interface UsbPrinterStatus {
  answered: boolean;
  printer: number | null;
  offline: number | null;
  roll: number | null;
  coverOpen: boolean;
  paperOut: boolean;
  error: boolean;
}

/** One line of text on the customer display; `right` is drawn flush right on the same line. */
export interface DisplayLine {
  text: string;
  right?: string;
  /** Pixel height of the text (the display is 65 px tall). Default 14. */
  size?: number;
  bold?: boolean;
  center?: boolean;
  /** A horizontal divider instead of text. */
  rule?: boolean;
}

export interface CustomerDisplayInfo {
  available: boolean;
  path: string | null;
  width: number;
  height: number;
  lastError: string | null;
}

export interface CustomerDisplayTest {
  path: string | null;
  sent: number;
  acked: number;
  error: string | null;
}

/** A device paired in Android's Bluetooth settings. `majorClass` is Android's BluetoothClass.Device.Major (-1 unknown). */
export interface BluetoothDeviceInfo {
  address: string;
  name: string;
  majorClass: number;
  /** Advertises the serial-port profile printers print over (unknown until Android has looked it up). */
  spp: boolean;
}

interface PosHardwareNative {
  listUsbPrinters(): UsbPrinterInfo[];
  bluetoothState(): { supported: boolean; enabled: boolean };
  listBluetoothDevices(): BluetoothDeviceInfo[];
  printBluetooth(address: string, bytes: Uint8Array): Promise<void>;
  usbPrinterStatus(): Promise<UsbPrinterStatus>;
  printUsb(bytes: Uint8Array): Promise<void>;
  openCashDrawer(): Promise<void>;
  customerDisplayInfo(): CustomerDisplayInfo;
  customerDisplayShow(lines: DisplayLine[]): boolean;
  customerDisplayShowQr(qr: string[], lines: DisplayLine[]): boolean;
  customerDisplayTest(lines: DisplayLine[]): Promise<CustomerDisplayTest>;
  pbkdf2Sha256(password: string, saltB64: string, iterations: number): Promise<string>;
}

/** Null on builds/platforms without the module (iOS, older dev builds): callers fall back. */
const Native = requireOptionalNativeModule<PosHardwareNative>("PosHardware");

export function listUsbPrinters(): UsbPrinterInfo[] {
  try {
    return Native?.listUsbPrinters() ?? [];
  } catch {
    return [];
  }
}

export function printUsb(bytes: Uint8Array): Promise<void> {
  if (!Native) return Promise.reject(new Error("This build can't use USB printers"));
  return Native.printUsb(bytes);
}

export function bluetoothState(): { supported: boolean; enabled: boolean } {
  try {
    return Native?.bluetoothState() ?? { supported: false, enabled: false };
  } catch {
    return { supported: false, enabled: false };
  }
}

/** Paired Bluetooth devices (empty when Bluetooth is off or not allowed). */
export function listBluetoothDevices(): BluetoothDeviceInfo[] {
  try {
    return Native?.listBluetoothDevices() ?? [];
  } catch {
    return [];
  }
}

/** Raw ESC/POS to a paired Bluetooth printer (classic SPP). */
export function printBluetooth(address: string, bytes: Uint8Array): Promise<void> {
  if (!Native) return Promise.reject(new Error("This build can't use Bluetooth printers"));
  return Native.printBluetooth(address, bytes);
}

export function usbPrinterStatus(): Promise<UsbPrinterStatus> {
  if (!Native) return Promise.reject(new Error("This build can't use USB printers"));
  return Native.usbPrinterStatus();
}

/** PBKDF2-HMAC-SHA256 (32-byte key, base64) for till PINs, computed natively off the JS thread. */
export function pbkdf2Sha256(password: string, saltB64: string, iterations: number): Promise<string> {
  if (!Native) return Promise.reject(new Error("This build can't check PINs"));
  return Native.pbkdf2Sha256(password, saltB64, iterations);
}

/** Pulse the cash drawer wired to the printer board. */
export function openCashDrawer(): Promise<void> {
  if (!Native) return Promise.reject(new Error("This build can't open a cash drawer"));
  return Native.openCashDrawer();
}

export function customerDisplayInfo(): CustomerDisplayInfo | null {
  try {
    return Native?.customerDisplayInfo() ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget: the newest picture wins. False when this machine has no customer display. */
export function customerDisplayShow(lines: DisplayLine[]): boolean {
  try {
    return Native?.customerDisplayShow(lines) ?? false;
  } catch {
    return false;
  }
}

/** A QR code (rows of "1"/"0" modules) on the left of the display, with these lines beside it. */
export function customerDisplayShowQr(qr: string[], lines: DisplayLine[]): boolean {
  try {
    return Native?.customerDisplayShowQr(qr, lines) ?? false;
  } catch {
    return false;
  }
}

export function customerDisplayTest(lines: DisplayLine[]): Promise<CustomerDisplayTest> {
  if (!Native) return Promise.reject(new Error("This build has no customer display support"));
  return Native.customerDisplayTest(lines);
}
