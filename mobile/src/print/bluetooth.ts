import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { toBase64 } from "./escpos";

/**
 * Bluetooth transports for ESC/POS receipt printers.
 *
 * - "classic": Bluetooth Classic (SPP/RFCOMM). Most cheap 58/80 mm printers. Android
 *   only; the printer must first be paired in Android's Bluetooth settings.
 * - "ble": Bluetooth Low Energy. Printers that advertise a BLE serial service. Works on
 *   Android and iOS (iOS only allows BLE).
 *
 * Both libraries are native modules, so they exist only in an installed build of the
 * app (EAS / `expo run:android`), not in Expo Go. Modules are loaded lazily so the app
 * still runs in Expo Go and simply reports printing as unavailable.
 */

export type PrinterTransport = "classic" | "ble";

export interface PrinterDevice {
  transport: PrinterTransport;
  id: string;
  name: string;
}

export function bluetoothSupport() {
  return {
    classic: Platform.OS === "android" && Boolean(NativeModules.RNBluetoothClassic),
    ble: Boolean(NativeModules.BlePlx)
  };
}

export class PrinterError extends Error {}

// ----- permissions ---------------------------------------------------------------

async function ensureAndroidPermissions(scan: boolean) {
  if (Platform.OS !== "android") return;
  const version = typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
  const wanted =
    version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, ...(scan ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] : [])]
      : scan
        ? [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
        : [];
  if (!wanted.length) return;
  const result = await PermissionsAndroid.requestMultiple(wanted);
  const denied = wanted.filter((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length) throw new PrinterError("Allow Bluetooth (\"Nearby devices\") permission for NaijaPOS in the phone settings to use the printer.");
}

// ----- Bluetooth Classic -------------------------------------------------------------

type ClassicDevice = { address: string; name: string; isConnected(): Promise<boolean>; write(data: string, encoding?: string): Promise<boolean> };
type ClassicModule = {
  isBluetoothEnabled(): Promise<boolean>;
  requestBluetoothEnabled(): Promise<boolean>;
  getBondedDevices(): Promise<ClassicDevice[]>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<ClassicDevice>;
  getConnectedDevice(address: string): Promise<ClassicDevice>;
  isDeviceConnected(address: string): Promise<boolean>;
  disconnectFromDevice(address: string): Promise<boolean>;
  writeToDevice(address: string, message: string, encoding?: string): Promise<boolean>;
};

function classic(): ClassicModule {
  if (!bluetoothSupport().classic) throw new PrinterError("Bluetooth Classic printing is not available in this build of the app.");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("react-native-bluetooth-classic").default as ClassicModule;
}

async function classicReady() {
  await ensureAndroidPermissions(false);
  const module = classic();
  if (!(await module.isBluetoothEnabled())) {
    const enabled = await module.requestBluetoothEnabled().catch(() => false);
    if (!enabled) throw new PrinterError("Turn on Bluetooth to print.");
  }
  return module;
}

async function classicDevices(): Promise<PrinterDevice[]> {
  const module = await classicReady();
  const bonded = await module.getBondedDevices();
  return bonded.map((device) => ({ transport: "classic" as const, id: device.address, name: device.name || device.address }));
}

async function classicPrint(address: string, bytes: Uint8Array) {
  const module = await classicReady();
  const connected = await module.isDeviceConnected(address).catch(() => false);
  if (!connected) {
    try {
      // Raw byte connection: no delimiter, the printer never sends lines back.
      await module.connectToDevice(address, { connectionType: "binary", delimiter: "", charset: "ISO-8859-1" });
    } catch (error) {
      throw new PrinterError(`Could not connect to the printer. Is it switched on and paired? (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  // Large receipts are sent in parts so slow printers' buffers are not overrun.
  const chunk = 512;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    await module.writeToDevice(address, toBase64(bytes.slice(offset, offset + chunk)), "base64");
    if (offset + chunk < bytes.length) await delay(30);
  }
}

// ----- BLE ---------------------------------------------------------------------------

type BleCharacteristic = { uuid: string; serviceUUID: string; isWritableWithResponse: boolean; isWritableWithoutResponse: boolean };
type BleDevice = { id: string; name: string | null; localName: string | null; mtu: number };
type BleManagerLike = {
  state(): Promise<string>;
  startDeviceScan(uuids: string[] | null, options: Record<string, unknown> | null, listener: (error: Error | null, device: BleDevice | null) => void): Promise<void> | void;
  stopDeviceScan(): Promise<void> | void;
  connectToDevice(id: string, options?: Record<string, unknown>): Promise<BleDevice>;
  isDeviceConnected(id: string): Promise<boolean>;
  discoverAllServicesAndCharacteristicsForDevice(id: string): Promise<BleDevice>;
  servicesForDevice(id: string): Promise<{ uuid: string }[]>;
  characteristicsForDevice(id: string, serviceUUID: string): Promise<BleCharacteristic[]>;
  requestMTUForDevice(id: string, mtu: number): Promise<BleDevice>;
  writeCharacteristicWithResponseForDevice(id: string, service: string, characteristic: string, base64: string): Promise<unknown>;
  writeCharacteristicWithoutResponseForDevice(id: string, service: string, characteristic: string, base64: string): Promise<unknown>;
  cancelDeviceConnection(id: string): Promise<unknown>;
};

/** Write channels used by common BLE receipt printers, tried first. */
const knownPrinterServices = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb"
];

let bleManager: BleManagerLike | null = null;
const bleWriteTargets = new Map<string, { service: string; characteristic: string; withResponse: boolean; chunk: number }>();

function ble(): BleManagerLike {
  if (!bluetoothSupport().ble) throw new PrinterError("Bluetooth LE printing is not available in this build of the app.");
  if (!bleManager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager } = require("react-native-ble-plx") as { BleManager: new () => BleManagerLike };
    bleManager = new BleManager();
  }
  return bleManager;
}

async function bleReady(scan: boolean) {
  await ensureAndroidPermissions(scan);
  const manager = ble();
  let state = await manager.state();
  for (let attempt = 0; state === "Unknown" && attempt < 10; attempt += 1) {
    await delay(200);
    state = await manager.state();
  }
  if (state === "PoweredOff") throw new PrinterError("Turn on Bluetooth to print.");
  if (state === "Unauthorized") throw new PrinterError("Allow Bluetooth access for NaijaPOS in the device settings.");
  if (state === "Unsupported") throw new PrinterError("This device does not support Bluetooth LE.");
  return manager;
}

async function bleScan(seconds = 8): Promise<PrinterDevice[]> {
  const manager = await bleReady(true);
  const found = new Map<string, PrinterDevice>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void manager.stopDeviceScan();
      resolve();
    }, seconds * 1000);
    void manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        clearTimeout(timer);
        void manager.stopDeviceScan();
        reject(new PrinterError(error.message));
        return;
      }
      const name = device?.name ?? device?.localName;
      if (device && name) found.set(device.id, { transport: "ble", id: device.id, name });
    });
  });
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function bleTarget(manager: BleManagerLike, id: string) {
  const cached = bleWriteTargets.get(id);
  if (cached) return cached;

  await manager.discoverAllServicesAndCharacteristicsForDevice(id);
  let mtu = 23;
  if (Platform.OS === "android") mtu = (await manager.requestMTUForDevice(id, 185).catch(() => ({ mtu: 23 }) as BleDevice)).mtu || 23;
  const services = (await manager.servicesForDevice(id)).map((service) => service.uuid.toLowerCase());
  const ordered = [...knownPrinterServices.filter((uuid) => services.includes(uuid)), ...services.filter((uuid) => !knownPrinterServices.includes(uuid))];

  for (const service of ordered) {
    const characteristics = await manager.characteristicsForDevice(id, service);
    const writable = characteristics.find((item) => item.isWritableWithoutResponse) ?? characteristics.find((item) => item.isWritableWithResponse);
    if (writable) {
      const target = {
        service,
        characteristic: writable.uuid,
        withResponse: !writable.isWritableWithoutResponse,
        // iOS negotiates MTU itself; 100 bytes is safe for nearly all printers there.
        chunk: Platform.OS === "ios" ? 100 : Math.max(20, Math.min(mtu - 3, 180))
      };
      bleWriteTargets.set(id, target);
      return target;
    }
  }
  throw new PrinterError("This Bluetooth device does not accept print data. Choose your receipt printer.");
}

async function blePrint(id: string, bytes: Uint8Array) {
  const manager = await bleReady(false);
  try {
    if (!(await manager.isDeviceConnected(id))) {
      bleWriteTargets.delete(id);
      await manager.connectToDevice(id, { timeout: 10_000 });
    }
  } catch (error) {
    throw new PrinterError(`Could not connect to the printer. Is it switched on and nearby? (${error instanceof Error ? error.message : String(error)})`);
  }
  const target = await bleTarget(manager, id);
  for (let offset = 0; offset < bytes.length; offset += target.chunk) {
    const part = toBase64(bytes.slice(offset, offset + target.chunk));
    if (target.withResponse) await manager.writeCharacteristicWithResponseForDevice(id, target.service, target.characteristic, part);
    else {
      await manager.writeCharacteristicWithoutResponseForDevice(id, target.service, target.characteristic, part);
      await delay(15); // cheap printers drop data if it arrives faster than they print
    }
  }
}

// ----- public API ------------------------------------------------------------------

export async function listPrinters(transport: PrinterTransport) {
  return transport === "classic" ? classicDevices() : bleScan();
}

export async function sendToPrinter(device: Pick<PrinterDevice, "transport" | "id">, bytes: Uint8Array) {
  try {
    if (device.transport === "classic") await classicPrint(device.id, bytes);
    else await blePrint(device.id, bytes);
  } catch (error) {
    if (device.transport === "ble") bleWriteTargets.delete(device.id);
    if (error instanceof PrinterError) throw error;
    throw new PrinterError(`Printing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
