/**
 * Emit a menu-change event to every connected client.
 *
 * Unlike order events there is no per-user targeting: a price, name, or
 * visibility change affects the menu everyone is looking at, so it goes out
 * as a broadcast. Guests hold no JWT and therefore never connect — the menu
 * page falls back to polling for them.
 *
 * `io` may be undefined when the socket server is not available; the call is
 * then a no-op so route logic never has to null-check.
 *
 * @param {import("socket.io").Server | undefined} io
 * @param {string} event - event name, e.g. "product:updated"
 * @param {object} [payload]
 */
function emitProductEvent(io, event, payload = {}) {
  if (!io) return;
  io.emit(event, payload);
}

module.exports = { emitProductEvent };
