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

// Stored option values that read as a ticked / unticked checkbox on the ticket.
const POSITIVE = new Set(["yes", "true", "1"]);
const NEGATIVE = new Set(["no", "false", "0", ""]);

/**
 * The ticket's headline: the day's order number always, then the customer's
 * name when one was given — "#12 Anna", or just "#12".
 */
function ticketLabel(order) {
  const number = `#${order.order_number ?? order.id}`;
  const name = order.customer_name?.trim();
  return name ? `${number} ${name}` : number;
}

/**
 * The option lines under one item. A value-style option (size, sugar, ...)
 * prints as "Size: Large". A checkbox prints only when ticked, and then as its
 * bare name — "Take away", not "Take away: Yes" — while an unticked one is left
 * off entirely, so the barista reads only what to do.
 *
 * `checkboxNames` is the item's checkbox definitions when the caller attached
 * them; a stored "Yes"/"true" is treated as a ticked box either way.
 */
function optionLines(options, checkboxNames) {
  const lines = [];
  for (const opt of options) {
    const name = opt.option_definition_name;
    const value = String(opt.option_value_name ?? "").trim();
    const normalized = value.toLowerCase();
    if (checkboxNames.has(name) || POSITIVE.has(normalized)) {
      if (!NEGATIVE.has(normalized)) lines.push(`   ${name}`);
      continue;
    }
    lines.push(`   ${name}: ${value}`);
  }
  return lines;
}

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

  write(ticketLabel(order), true);
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

    for (const line of optionLines(options, checkboxNames)) {
      write(line);
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
