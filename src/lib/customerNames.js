// Customer names the counter has typed, offered back as suggestions in the
// terminal's "Customer name" field (`customer_name_suggestions`, see
// scripts/migration_customer_name_suggestions.sql).
//
// One row per distinct name per organization. The column's collation
// (utf8mb4_unicode_ci) is case- and accent-insensitive, so "anna", "Anna" and
// "Ana" with a stray accent fold onto one row instead of piling up variants.
// Organizations without one share bucket 0.

/** Same width as the column. Longer names are stored truncated. */
const MAX_NAME_LENGTH = 100;

const isMissingTable = (err) => Boolean(err) && err.code === "ER_NO_SUCH_TABLE";

const orgKey = (organizationId) => Number(organizationId) || 0;

/** Collapse runs of whitespace so "Anna  K" and "Anna K" are the same name. */
function cleanName(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** Escape LIKE's own wildcards so a typed "%" or "_" matches literally. */
const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Names matching what has been typed so far: those starting with it first,
 * then those with a later word starting with it ("ann" finds "Anna" and
 * "Mary Ann"), each ranked by how often and how recently they were used.
 *
 * Answers [] before the migration has run — the field just stops suggesting.
 */
async function searchCustomerNames(pool, organizationId, query, limit = 8) {
  const q = cleanName(query);
  if (!q) return [];
  const prefix = `${escapeLike(q)}%`;
  const wordPrefix = `% ${escapeLike(q)}%`;
  try {
    const [rows] = await pool.query(
      `SELECT name
         FROM customer_name_suggestions
        WHERE organization_id = ?
          AND (name LIKE ? OR name LIKE ?)
        ORDER BY (name LIKE ?) DESC, use_count DESC, last_used_at DESC
        LIMIT ?`,
      [orgKey(organizationId), prefix, wordPrefix, prefix, limit],
    );
    return rows.map((row) => row.name);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/**
 * Record that a name was used on an order. A new name is added; one already
 * there (in any case) just has its count and last use bumped, keeping the
 * spelling it was first saved with.
 *
 * Best-effort like printing: never throws, so it can't fail an order.
 */
async function rememberCustomerName(pool, organizationId, raw) {
  const name = cleanName(raw);
  if (!name) return;
  try {
    await pool.query(
      `INSERT INTO customer_name_suggestions (organization_id, name)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP`,
      [orgKey(organizationId), name],
    );
  } catch (err) {
    if (!isMissingTable(err)) {
      console.error("Saving customer name suggestion failed:", err);
    }
  }
}

module.exports = { searchCustomerNames, rememberCustomerName };
