// Minimal ESC/POS byte builder for the MUNBYN ITPP047P (and any compatible
// 80mm thermal receipt printer). Reference: MUNBYN's published ESC/POS HEX
// command list (support.munbyn.com) — standard Epson-compatible command set.

const ESC = 0x1b;
const GS = 0x1d;

const DIVIDER = "-".repeat(32);

// 203 dpi head (8 dots/mm) at the default 30-dot line spacing => 3.75 mm per
// text line. All the length math below is in these "line units".
const LINE_HEIGHT_MM = 3.75;

// Gap between the print head and the cutter blade. Feed at least this much
// after the last line or the blade cuts through it and the bottom row comes
// out clipped in half.
const CUT_CLEARANCE_MM = 10;

// Pad every ticket out to this length. A one-drink order otherwise prints a
// stub that's awkward to tear off and easy to lose on the pass.
const MIN_TICKET_MM = 100;

const mmToLines = (mm) => Math.ceil(mm / LINE_HEIGHT_MM);

// Stored option values that should read as an unticked checkbox on the ticket.
const NEGATIVE = new Set(["no", "false", "0", ""]);

function init() {
  return Buffer.from([ESC, 0x40]);
}

function bold(on) {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

function align(mode) {
  // 0 = left, 1 = center, 2 = right
  return Buffer.from([ESC, 0x61, mode]);
}

function doubleSize(on) {
  return Buffer.from([GS, 0x21, on ? 0x11 : 0x00]);
}

function text(line = "") {
  return Buffer.from(`${line}\n`, "utf8");
}

function feed(lines = 1) {
  return Buffer.from([ESC, 0x64, lines]);
}

function cut() {
  return Buffer.from([GS, 0x56, 0x00]);
}

function buildKitchenTicket(order, items) {
  const parts = [init(), align(1), doubleSize(true), bold(true)];

  // Running height of what we've pushed so far, so the trailing feed can pad a
  // short ticket up to MIN_TICKET_MM. Wrapped long lines are undercounted here,
  // which only ever makes a ticket longer than the minimum — never shorter.
  let lines = 0;
  const write = (line, tall = false) => {
    parts.push(text(line));
    lines += tall ? 2 : 1;
  };

  const label =
    order.customer_name?.trim() || `#${order.order_number ?? order.id}`;
  write(label, true);
  parts.push(doubleSize(false), bold(false), align(0));

  const createdAt = order.created_at ? new Date(order.created_at) : new Date();
  write(createdAt.toLocaleString());
  write(DIVIDER);

  for (const item of items ?? []) {
    const qty = item.quantity ?? 1;
    const name = item.product_item_name ?? "Item";
    parts.push(bold(true));
    write(`${qty}x ${name}`);
    parts.push(bold(false));

    const options = Array.isArray(item.product_item_options)
      ? item.product_item_options
      : [];
    const checkboxes = Array.isArray(item.checkbox_options)
      ? item.checkbox_options
      : [];
    const checkboxNames = new Set(checkboxes.map((c) => c.name));

    // Selected value-style options (size, sugar, temperature, ...).
    for (const opt of options) {
      if (checkboxNames.has(opt.option_definition_name)) continue;
      write(`   ${opt.option_definition_name}: ${opt.option_value_name}`);
    }

    // Every checkbox the product offers, answered Yes or No. An unticked box is
    // never written to order_item_options, so "no stored row" means No.
    const ticked = new Set(
      options
        .filter((o) => !NEGATIVE.has(String(o.option_value_name).trim().toLowerCase()))
        .map((o) => o.option_definition_name),
    );
    for (const cb of checkboxes) {
      write(`   ${cb.name}: ${ticked.has(cb.name) ? "Yes" : "No"}`);
    }

    if (item.comment) {
      write(`   note: ${item.comment}`);
    }
  }

  write(DIVIDER);
  if (order.comment) {
    write(`Order note: ${order.comment}`);
  }

  // One trailing feed covers both rules: always clear the cutter, and stretch a
  // short ticket out to the minimum length.
  const tail = Math.max(
    mmToLines(CUT_CLEARANCE_MM),
    mmToLines(MIN_TICKET_MM) - lines,
  );
  parts.push(feed(tail), cut());

  return Buffer.concat(parts);
}

module.exports = {
  init,
  bold,
  align,
  doubleSize,
  text,
  feed,
  cut,
  buildKitchenTicket,
};
