const pkg = require("../../package.json");

/**
 * The running build.
 *
 * package.json is the one place the number is edited, and it ships inside the
 * release tarball, so this is the version of the code actually answering
 * requests — not whatever the developer's checkout says. See VERSIONING.md for
 * when to change it.
 */
const appName = pkg.name;
const appVersion = pkg.version;

module.exports = { appName, appVersion };
