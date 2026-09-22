const fs = require("fs");

/**
 * Make sure an upload directory exists and is writable by the user this process
 * runs as, complaining loudly at boot if it isn't.
 *
 * In production these directories are symlinks into `shared/uploads/`, created
 * by hand during server setup. Get their ownership wrong and nothing looks
 * broken until a staff member tries to change a photo and gets an `EACCES` —
 * long after anyone is watching a deploy. A line in the PM2 log at startup
 * turns that into something you find before a customer does.
 *
 * Deliberately never throws: a cafe that can't accept a new avatar should still
 * be able to take orders.
 */
function ensureUploadDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(
      `[uploads] Could not create ${dir} (${err.code}). Image uploads will fail.\n` +
        `[uploads] Fix: chown the shared uploads tree to the user PM2 runs as.`,
    );
    return false;
  }

  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (err) {
    console.error(
      `[uploads] ${dir} is NOT writable by uid ${process.getuid?.()} (${err.code}). ` +
        `Image uploads will fail until this is fixed.\n` +
        `[uploads] Fix: sudo chown -R <pm2-user> $(readlink -f ${dir})`,
    );
    return false;
  }
}

module.exports = { ensureUploadDir };
