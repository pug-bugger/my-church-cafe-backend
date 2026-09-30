/**
 * Emit an order-related realtime event to both the staff room and the
 * per-user rooms of everyone the order concerns — the pattern routes repeat by
 * hand.
 *
 * An order can concern two accounts: whoever entered it (`orders.user_id`) and
 * the customer it is for (`orders.customer_user_id`, set when the terminal
 * scans a card). Pass both; nulls and duplicates are dropped, so nobody gets
 * the same event twice.
 *
 * `io` may be undefined when the socket server is not available; the call is
 * then a no-op so route logic never has to null-check.
 *
 * @param {import("socket.io").Server | undefined} io
 * @param {number|string|null|undefined|Array<number|string|null|undefined>} userIds - users to notify
 * @param {string} event - event name, e.g. "order:created"
 * @param {object} payload
 */
function emitOrderEvent(io, userIds, event, payload) {
  if (!io) return;
  io.to("staff").emit(event, payload);
  const ids = new Set(
    (Array.isArray(userIds) ? userIds : [userIds])
      .filter((id) => id != null)
      .map(Number),
  );
  for (const id of ids) {
    io.to(`user:${id}`).emit(event, payload);
  }
}

module.exports = { emitOrderEvent };
