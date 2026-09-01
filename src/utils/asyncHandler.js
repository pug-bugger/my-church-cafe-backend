/**
 * Wrap an async Express route handler so a rejected promise is forwarded to
 * `next(err)` and handled by the central error middleware in `server.js`.
 *
 * Replaces the repeated `try { ... } catch (err) { return next(err); }` in
 * every route handler:
 *
 *   router.get("/", asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
