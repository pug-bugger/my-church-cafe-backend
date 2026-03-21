const express = require("express");
const { getPool } = require("../config/db");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

function slugify(name) {
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s || "option";
}

async function ensureUniqueOptionKey(pool, baseKey, excludeId) {
  let key = baseKey;
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = [key];
    let sql =
      "SELECT id FROM drink_option_definitions WHERE option_key = ?";
    if (excludeId != null) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return key;
    n += 1;
    key = `${baseKey}_${n}`;
  }
}

// Public: list all reusable option definitions with values (for admin UI + product form)
router.get("/", async (_req, res, next) => {
  try {
    const pool = getPool();
    const [defs] = await pool.query(
      `SELECT id, name, option_key, type, checkbox_extra_price, sort_order
       FROM drink_option_definitions
       ORDER BY sort_order ASC, name ASC`,
    );
    if (!defs.length) return res.json([]);
    const ids = defs.map((d) => d.id);
    const [vals] = await pool.query(
      `SELECT id, option_definition_id, label, extra_price, sort_order
       FROM drink_option_values
       WHERE option_definition_id IN (?)
       ORDER BY sort_order ASC, id ASC`,
      [ids],
    );
    const byDef = new Map();
    for (const v of vals) {
      if (!byDef.has(v.option_definition_id)) {
        byDef.set(v.option_definition_id, []);
      }
      byDef.get(v.option_definition_id).push({
        id: v.id,
        label: v.label,
        extra_price: Number(v.extra_price ?? 0),
        sort_order: v.sort_order,
      });
    }
    const out = defs.map((d) => ({
      id: d.id,
      name: d.name,
      option_key: d.option_key,
      type: d.type,
      checkbox_extra_price: Number(d.checkbox_extra_price ?? 0),
      sort_order: d.sort_order,
      values: byDef.get(d.id) || [],
    }));
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

router.use(authMiddleware);

// Admin: create definition (optional initial values for select)
router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, type, checkbox_extra_price, sort_order, values } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: "name and type required" });
    }
    if (type !== "checkbox" && type !== "select") {
      return res.status(400).json({ error: "type must be checkbox or select" });
    }
    const pool = getPool();
    const baseKey = slugify(name);
    const option_key = await ensureUniqueOptionKey(pool, baseKey, null);
    const [r] = await pool.query(
      `INSERT INTO drink_option_definitions (name, option_key, type, checkbox_extra_price, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        option_key,
        type,
        type === "checkbox" ? Number(checkbox_extra_price ?? 0) : 0,
        sort_order ?? 0,
      ],
    );
    const defId = r.insertId;
    if (
      type === "select" &&
      Array.isArray(values) &&
      values.length
    ) {
      const rows = values.map((v, i) => [
        defId,
        v.label,
        Number(v.extra_price ?? 0),
        v.sort_order ?? i,
      ]);
      await pool.query(
        `INSERT INTO drink_option_values (option_definition_id, label, extra_price, sort_order) VALUES ?`,
        [rows],
      );
    }
    return res.status(201).json({ id: defId });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const { name, type, checkbox_extra_price, sort_order } = req.body;
    const pool = getPool();
    const [defs] = await pool.query(
      "SELECT id FROM drink_option_definitions WHERE id = ?",
      [req.params.id],
    );
    if (!defs.length) return res.status(404).json({ error: "Not found" });
    let option_key = null;
    if (name) {
      const baseKey = slugify(name);
      option_key = await ensureUniqueOptionKey(
        pool,
        baseKey,
        Number(req.params.id),
      );
    }
    await pool.query(
      `UPDATE drink_option_definitions SET
        name = COALESCE(?, name),
        option_key = COALESCE(?, option_key),
        type = COALESCE(?, type),
        checkbox_extra_price = COALESCE(?, checkbox_extra_price),
        sort_order = COALESCE(?, sort_order)
       WHERE id = ?`,
      [
        name || null,
        option_key,
        type || null,
        checkbox_extra_price != null ? Number(checkbox_extra_price) : null,
        sort_order ?? null,
        req.params.id,
      ],
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireRole("admin"), async (req, res, next) => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM drink_option_definitions WHERE id = ?", [
      req.params.id,
    ]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/values", requireRole("admin"), async (req, res, next) => {
  try {
    const { label, extra_price, sort_order } = req.body;
    if (!label) return res.status(400).json({ error: "label required" });
    const pool = getPool();
    const [defs] = await pool.query(
      "SELECT id, type FROM drink_option_definitions WHERE id = ?",
      [req.params.id],
    );
    if (!defs.length) return res.status(404).json({ error: "Not found" });
    if (defs[0].type === "checkbox") {
      return res
        .status(400)
        .json({ error: "checkbox options do not use value rows" });
    }
    const [r] = await pool.query(
      `INSERT INTO drink_option_values (option_definition_id, label, extra_price, sort_order)
       VALUES (?, ?, ?, ?)`,
      [
        req.params.id,
        label,
        Number(extra_price ?? 0),
        sort_order ?? 0,
      ],
    );
    return res.status(201).json({ id: r.insertId });
  } catch (err) {
    return next(err);
  }
});

router.put("/values/:valueId", requireRole("admin"), async (req, res, next) => {
  try {
    const { label, extra_price, sort_order } = req.body;
    const pool = getPool();
    await pool.query(
      `UPDATE drink_option_values SET
        label = COALESCE(?, label),
        extra_price = COALESCE(?, extra_price),
        sort_order = COALESCE(?, sort_order)
       WHERE id = ?`,
      [
        label || null,
        extra_price != null ? Number(extra_price) : null,
        sort_order ?? null,
        req.params.valueId,
      ],
    );
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.delete(
  "/values/:valueId",
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = getPool();
      await pool.query("DELETE FROM drink_option_values WHERE id = ?", [
        req.params.valueId,
      ]);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
