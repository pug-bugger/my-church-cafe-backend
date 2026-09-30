/**
 * Push notification wording, in every language the apps ship.
 *
 * The apps' strings live in the shared catalogue (`my-church-cafe/src/i18n`),
 * but a push is written here, on the server, while the phone may be asleep.
 * So the handful of messages the server sends are kept here, and the language
 * comes from the device that registered the token (`user_push_tokens.language`).
 * Keep the set in step with `LOCALES` in the apps: a language missing here
 * falls back to English.
 */

const MESSAGES = {
  orderReady: {
    en: { title: "Your order is ready", body: "Order {number} is ready for pickup." },
    lt: { title: "Jūsų užsakymas paruoštas", body: "Užsakymas {number} paruoštas atsiimti." },
    ru: { title: "Ваш заказ готов", body: "Заказ {number} готов — можно забирать." },
  },
  orderCancelled: {
    en: { title: "Order cancelled", body: "Order {number} was cancelled." },
    lt: { title: "Užsakymas atšauktas", body: "Užsakymas {number} buvo atšauktas." },
    ru: { title: "Заказ отменён", body: "Заказ {number} был отменён." },
  },
};

const SUPPORTED_LANGUAGES = ["en", "lt", "ru"];
const DEFAULT_LANGUAGE = "en";

function normalizeLanguage(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SUPPORTED_LANGUAGES.includes(id) ? id : DEFAULT_LANGUAGE;
}

/** `{ title, body }` for a message key, with `{name}` placeholders filled in. */
function notificationText(key, language, values = {}) {
  const message = MESSAGES[key];
  if (!message) throw new Error(`Unknown notification: ${key}`);
  const copy = message[normalizeLanguage(language)] ?? message[DEFAULT_LANGUAGE];
  const fill = (text) =>
    text.replace(/\{(\w+)\}/g, (match, name) =>
      values[name] != null ? String(values[name]) : match,
    );
  return { title: fill(copy.title), body: fill(copy.body) };
}

module.exports = { notificationText, normalizeLanguage, SUPPORTED_LANGUAGES };
