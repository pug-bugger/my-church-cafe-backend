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
    // Print both sides of the mismatch. The failure this was written for was a
    // shared/uploads tree copied off a Mac during a server migration: it stayed
    // owned by uid 501 with mode 775, so the app user fell through to "other"
    // and could read every avatar but write none. Owner-vs-process makes that
    // obvious; "not writable" on its own does not.
    let owner = "unknown";
    try {
      const st = fs.statSync(dir);
      owner = `uid ${st.uid}, gid ${st.gid}, mode ${(st.mode & 0o777).toString(8)}`;
    } catch (_e) {
      /* fall through with "unknown" */
    }
    console.error(
      `[uploads] ${dir} is NOT writable (${err.code}). Image uploads will fail.\n` +
        `[uploads]   directory is owned by ${owner}\n` +
        `[uploads]   this process runs as uid ${process.getuid?.()}, gid ${process.getgid?.()}\n` +
        `[uploads] Fix: chown -R <that process user> $(readlink -f ${dir})`,
    );
    return false;
  }
}

module.exports = { ensureUploadDir };
