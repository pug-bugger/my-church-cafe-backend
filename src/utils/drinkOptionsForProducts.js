/**
 * Load drink option definitions assigned to products (junction + definitions + values).
 */

async function fetchDrinkOptionsForProducts(pool, productIds) {
  if (!productIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT pdo.product_id,
            d.id AS def_id,
            d.name AS def_name,
            d.option_key,
            d.type,
            d.checkbox_extra_price,
            pdo.sort_order AS pdo_sort,
            v.id AS value_id,
            v.label AS value_label,
            v.extra_price AS value_extra,
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
        option_key: row.option_key,
        type: row.type,
        checkbox_extra_price: Number(row.checkbox_extra_price ?? 0),
        _pdo_sort: row.pdo_sort ?? 0,
        values: [],
      });
    }
    const def = defs.get(row.def_id);
    if (row.value_id) {
      def.values.push({
        id: row.value_id,
        label: row.value_label,
        extra_price: Number(row.value_extra ?? 0),
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
    option_key: d.option_key,
    type: d.type,
    checkbox_extra_price: d.checkbox_extra_price,
    values: d.values || [],
  }));
}

module.exports = {
  fetchDrinkOptionsForProducts,
  normalizeDrinkOptionsList,
};
