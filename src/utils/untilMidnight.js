/**
 * The next server-local midnight, as a MySQL DATETIME string
 * (`YYYY-MM-DD HH:MM:SS`).
 *
 * "Sold out until tomorrow" — for a product or a drink option — always ends
 * here. Formatted by hand rather than with toISOString(), which would turn it
 * into UTC and move the restore by the server's offset.
 */
function nextMidnightDatetime(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${midnight.getFullYear()}-${pad(midnight.getMonth() + 1)}-${pad(midnight.getDate())} ${pad(midnight.getHours())}:${pad(midnight.getMinutes())}:${pad(midnight.getSeconds())}`;
}

module.exports = { nextMidnightDatetime };
