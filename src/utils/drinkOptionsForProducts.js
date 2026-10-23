/**
 * Load drink option definitions assigned to products (junction + definitions + values).
 */

const { hasColumn } = require("./columns");

/**
 * Whether options can be marked sold out yet (migration_option_availability
 * adds the column to both tables at once, so one probe answers for both).
 */
const hasOptionAvailability = (conn) =>
  hasColumn(conn, "drink_option_values", "unavailable_until");

/**
 * Whether options carry Lithuanian / Russian names yet
 * (migration_option_translations adds them to both tables at once).
 */
const hasOptionTranslations = (conn) =>
  hasColumn(conn, "drink_option_definitions", "name_lt");

/**
 * A translation off a request body: the trimmed text, null to clear it, or
 * undefined when the field wasn't sent. Unlike the English name a blank
 * translation is allowed — it means "fall back to English".
 */
function readTranslation(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed.length > 100) {
    throw Object.assign(new Error(`${field} must be 100 characters or fewer`), {
      status: 400,
    });
  }
  return trimmed || null;
}

/** `alias.unavailable_until`, or NULL once that moment has passed. */
const UNTIL_SQL = (alias) =>
  `IF(${alias}.unavailable_until > NOW(), ${alias}.unavailable_until, NULL)`;

async function fetchDrinkOptionsForProducts(pool, productIds) {
  if (!productIds.length) return new Map();
  // The default columns arrive with migration_option_defaults; until it is run
  // every option simply has no default, which is the behaviour that shipped
  // before it (see utils/columns.js).
  const withValueDefault = await hasColumn(
    pool,
    "drink_option_values",
    "is_default",
  );
  const withCheckboxDefault = await hasColumn(
    pool,
    "drink_option_definitions",
    "checkbox_default",
  );
  // "Sold out until tomorrow" arrives with migration_option_availability. A
  // time already past means available again, so only a future one is sent —
  // no client ever has to compare clocks with the server to know.
  const withAvailability = await hasOptionAvailability(pool);
  const withTranslations = await hasOptionTranslations(pool);
  const [rows] = await pool.query(
    `SELECT pdo.product_id,
            d.id AS def_id,
            d.name AS def_name,
            ${withTranslations ? "d.name_lt AS def_name_lt, d.name_ru AS def_name_ru," : ""}
            d.option_key,
            d.type,
            d.checkbox_extra_price,
            ${withCheckboxDefault ? "d.checkbox_default," : ""}
            ${withAvailability ? `${UNTIL_SQL("d")} AS def_unavailable_until,` : ""}
            pdo.sort_order AS pdo_sort,
            v.id AS value_id,
            v.label AS value_label,
            ${withTranslations ? "v.label_lt AS value_label_lt, v.label_ru AS value_label_ru," : ""}
            v.extra_price AS value_extra,
            ${withValueDefault ? "v.is_default AS value_default," : ""}
            ${withAvailability ? `${UNTIL_SQL("v")} AS value_unavailable_until,` : ""}
            v.sort_order AS value_sort
     FROM product_drink_options pdo
     INNER JOIN drink_option_definitions d ON d.id = pdo.option_definition_id
     LEFT JOIN drink_option_values v ON v.option_definition_id = d.id
     WHERE pdo.product_id IN (?)
     ORDER BY pdo.sort_order ASC, v.sort_order ASC, v.id ASC`,
    [productIds],
  );

  const byProduct = new Map();
  for (const row of rows) {
    const pid = row.product_id;
    if (!byProduct.has(pid)) {
      byProduct.set(pid, new Map());
    }
    const defs = byProduct.get(pid);
    if (!defs.has(row.def_id)) {
      defs.set(row.def_id, {
        id: row.def_id,
        name: row.def_name,
        name_lt: row.def_name_lt ?? null,
        name_ru: row.def_name_ru ?? null,
        option_key: row.option_key,
        type: row.type,
        checkbox_extra_price: Number(row.checkbox_extra_price ?? 0),
        checkbox_default: Boolean(row.checkbox_default),
        unavailable_until: row.def_unavailable_until ?? null,
        _pdo_sort: row.pdo_sort ?? 0,
        values: [],
      });
    }
    const def = defs.get(row.def_id);
    if (row.value_id) {
      def.values.push({
        id: row.value_id,
        label: row.value_label,
        label_lt: row.value_label_lt ?? null,
        label_ru: row.value_label_ru ?? null,
        extra_price: Number(row.value_extra ?? 0),
        is_default: Boolean(row.value_default),
        unavailable_until: row.value_unavailable_until ?? null,
        sort_order: row.value_sort,
      });
    }
  }

  const result = new Map();
  for (const [pid, defsMap] of byProduct) {
    const list = Array.from(defsMap.values())
      .sort((a, b) => a._pdo_sort - b._pdo_sort)
      .map(({ _pdo_sort, ...rest }) => rest);
    result.set(pid, list);
  }
  return result;
}

function normalizeDrinkOptionsList(rawList) {
  if (!rawList) return [];
  return rawList.map((d) => ({
    id: d.id,
    name: d.name,
    name_lt: d.name_lt ?? null,
    name_ru: d.name_ru ?? null,
    option_key: d.option_key,
    type: d.type,
    checkbox_extra_price: d.checkbox_extra_price,
    checkbox_default: Boolean(d.checkbox_default),
    unavailable_until: d.unavailable_until ?? null,
    values: d.values || [],
  }));
}

module.exports = {
  hasOptionAvailability,
  hasOptionTranslations,
  readTranslation,
  UNTIL_SQL,
  fetchDrinkOptionsForProducts,
  normalizeDrinkOptionsList,
};
