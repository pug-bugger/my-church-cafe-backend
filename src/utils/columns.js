/**
 * Runtime "does this column exist yet?" check, cached per process.
 *
 * The backend redeploys automatically on a push to `prod` while migrations are
 * run by hand, so a deploy routinely lands before its migration does. Every
 * query that names a freshly added column has to survive that window, or the
 * menu and the terminal go down until someone runs the SQL — the same reason
 * `order_items.product_id` and `order_item_options.extra_price` are detected
 * rather than assumed.
 *
 * The answer is cached because it can only change when a migration runs, and a
 * migration means a restart is due anyway. A false is *not* cached forever
 * silently: restart the process after running a migration.
 */

/** `"table.column"` → boolean. */
const cache = new Map();

/**
 * @param {import("mysql2/promise").Pool | import("mysql2/promise").PoolConnection} conn
 * @param {string} table
 * @param {string} column
 * @returns {Promise<boolean>}
 */
async function hasColumn(conn, table, column) {
  const key = `${table}.${column}`;
  if (cache.has(key)) return cache.get(key);
  let found = false;
  try {
    // Table and column names can't be bound as parameters. Both are code
    // constants at every call site — never request data.
    const [rows] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [
      column,
    ]);
    found = rows.length > 0;
  } catch (err) {
    if (!err || err.code !== "ER_NO_SUCH_TABLE") throw err;
    found = false;
  }
  cache.set(key, found);
  return found;
}

/** Forget what has been probed — for tests, and after a migration in-process. */
function clearColumnCache() {
  cache.clear();
}

module.exports = { hasColumn, clearColumnCache };
