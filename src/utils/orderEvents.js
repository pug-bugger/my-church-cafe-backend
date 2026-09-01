/**
 * Emit an order-related realtime event to both the staff room and the
 * ordering customer's per-user room — the pattern routes repeat by hand.
 *
 * `io` may be undefined when the socket server is not available; the call is
 * then a no-op so route logic never has to null-check.
 *
 * @param {import("socket.io").Server | undefined} io
 * @param {number|string|null|undefined} userId - customer to notify
 * @param {string} event - event name, e.g. "order:created"
 * @param {object} payload
 */
function emitOrderEvent(io, userId, event, payload) {
  if (!io) return;
  io.to("staff").emit(event, payload);
  if (userId != null) {
    io.to(`user:${userId}`).emit(event, payload);
  }
}

module.exports = { emitOrderEvent };
