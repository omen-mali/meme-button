// Web Serial transport: newline-terminated ASCII lines at 115200 baud (PLAN.md 3).
// Only one program can hold the port: close Serial Monitor / `make monitor` first.

const BAUD = 115200;
const encoder = new TextEncoder();

let port = null;
let reader = null;
let readLoopDone = null;
let closing = false;
let writeChain = Promise.resolve();

export const isSupported = () => "serial" in navigator;
export const isOpen = () => port !== null;

// Must be called from a user gesture (requestPort shows the picker).
// onClose(lost) fires once when the port closes; lost = not user-initiated.
export async function connect({ onLine, onClose }) {
  const p = await navigator.serial.requestPort();
  await p.open({ baudRate: BAUD });
  port = p;
  closing = false;
  readLoopDone = readLoop(p, onLine).then(async () => {
    const lost = !closing;
    try { await p.close(); } catch { /* already gone (unplugged) */ }
    port = null;
    onClose(lost);
  });
}

async function readLoop(p, onLine) {
  const decoder = new TextDecoderStream();
  const piped = p.readable.pipeTo(decoder.writable).catch(() => {});
  reader = decoder.readable.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        // Drops \r and the garbage byte the UNO emits while resetting
        const line = buffer.slice(0, nl).replace(/[^\x20-\x7e]/g, "").trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
      }
    }
  } catch (err) {
    console.warn("serial read ended:", err);
  } finally {
    reader.releaseLock();
    reader = null;
    await piped;
  }
}

export async function disconnect() {
  if (!port) return;
  closing = true;
  await reader?.cancel().catch(() => {});
  await readLoopDone;
}

// Writes are queued so concurrent sends never fight over the writer lock.
export function send(cmd) {
  const p = port;
  if (!p?.writable) return Promise.resolve(false);
  writeChain = writeChain
    .then(async () => {
      const writer = p.writable.getWriter();
      try {
        await writer.write(encoder.encode(cmd + "\n"));
        return true;
      } finally {
        writer.releaseLock();
      }
    })
    .catch((err) => {
      console.warn("serial write failed:", err);
      return false;
    });
  return writeChain;
}
