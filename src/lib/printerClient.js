const net = require("net");
const { printer: printerConfig } = require("../config/env");

// Talks to a network thermal printer (MUNBYN ITPP047P, WiFi variant) using
// raw TCP/IP printing on port 9100 — the standard way to stream ESC/POS bytes
// to a networked receipt printer. No microcontroller in between: the backend
// opens a socket straight to the printer's IP, writes, and closes.

const CONNECT_TIMEOUT_MS = 4000;
const PROBE_INTERVAL_MS = 6000;

const state = {
  reachable: false,
  lastCheckedAt: null,
  lastPrintOk: null,
  lastError: null,
};

let probeTimer = null;

function getStatus() {
  return {
    ...state,
    configured: Boolean(printerConfig.host),
    host: printerConfig.host,
    port: printerConfig.port,
  };
}

// Lightweight connectivity check: open a socket to :9100 and immediately close
// it. The printer accepts a connection whenever it's powered and on-network,
// so this tells us the link is healthy without actually printing anything.
function probe() {
  if (!printerConfig.host) {
    state.reachable = false;
    state.lastError = "PRINTER_HOST not set";
    state.lastCheckedAt = Date.now();
    return;
  }
  const socket = net.connect({ host: printerConfig.host, port: printerConfig.port });
  socket.setTimeout(CONNECT_TIMEOUT_MS);
  const done = (reachable, err) => {
    state.reachable = reachable;
    state.lastCheckedAt = Date.now();
    if (err) state.lastError = err;
    socket.destroy();
  };
  socket.once("connect", () => done(true, null));
  socket.once("timeout", () => done(false, "Connection timed out"));
  socket.once("error", (e) => done(false, e.message));
}

function init() {
  if (!printerConfig.host) {
    console.warn(
      "[printerClient] PRINTER_HOST is not set — receipt printing is disabled.",
    );
  }
  probe();
  probeTimer = setInterval(probe, PROBE_INTERVAL_MS);
  if (typeof probeTimer.unref === "function") probeTimer.unref();
}

/**
 * Best-effort print: opens a TCP socket, writes the ESC/POS buffer, closes.
 * Resolves true on success, false on any failure — never rejects, so it can
 * never break order creation.
 */
function print(buffer) {
  return new Promise((resolve) => {
    if (!printerConfig.host) {
      state.lastPrintOk = false;
      state.lastError = "PRINTER_HOST not set";
      resolve(false);
      return;
    }
    const socket = net.connect({ host: printerConfig.host, port: printerConfig.port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    let wrote = false;
    const fail = (err) => {
      state.lastPrintOk = false;
      state.reachable = false;
      state.lastError = err;
      state.lastCheckedAt = Date.now();
      socket.destroy();
      resolve(false);
    };
    socket.once("connect", () => {
      socket.write(buffer, () => {
        wrote = true;
        socket.end(); // flush + close after the bytes are handed to the OS
      });
    });
    socket.once("close", () => {
      if (wrote) {
        state.lastPrintOk = true;
        state.reachable = true;
        state.lastError = null;
        state.lastCheckedAt = Date.now();
        resolve(true);
      }
      // if !wrote, one of the error/timeout handlers already resolved(false)
    });
    socket.once("timeout", () => fail("Connection timed out"));
    socket.once("error", (e) => fail(e.message));
  });
}

module.exports = { init, getStatus, print };
