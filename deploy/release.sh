#!/usr/bin/env bash
#
# Runs ON THE SERVER, invoked over SSH by .github/workflows/deploy-backend.yml.
#
#   release.sh <tarball-path> <git-sha>
#
# Unpacks a release next to the previous ones, wires it to the shared state
# (.env and uploads/), flips the `current` symlink atomically, reloads PM2, and
# health-checks the result. If the new release fails its health check the
# symlink is flipped back and PM2 reloaded again, so a bad release leaves the
# previous version serving traffic.

set -euo pipefail

APP_NAME="${APP_NAME:-church-cafe-backend}"
APP_DIR="${APP_DIR:-/var/www/church-cafe-backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

TARBALL="${1:?usage: release.sh <tarball-path> <git-sha>}"
SHA="${2:?usage: release.sh <tarball-path> <git-sha>}"

RELEASE_DIR="$APP_DIR/releases/$SHA"
SHARED_DIR="$APP_DIR/shared"
ECOSYSTEM="$APP_DIR/ecosystem.config.js"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

[ -f "$TARBALL" ] || { echo "tarball not found: $TARBALL" >&2; exit 1; }
[ -d "$APP_DIR/releases" ] || { echo "$APP_DIR/releases missing - run server-setup.sh first" >&2; exit 1; }

# Refuse to deploy without real secrets. src/config/env.js falls back to
# JWT_SECRET="change_this_secret" and an empty DB password when .env is absent,
# so the server would start and quietly sign forgeable tokens.
[ -f "$SHARED_DIR/.env" ] || {
  echo "$SHARED_DIR/.env is missing - run server-setup.sh first" >&2
  exit 1
}
[ -d "$SHARED_DIR/uploads" ] || {
  echo "$SHARED_DIR/uploads is missing - run server-setup.sh first" >&2
  exit 1
}

# Remember where we can roll back to before touching anything.
PREVIOUS_DIR=""
if [ -L "$APP_DIR/current" ]; then
  PREVIOUS_DIR="$(readlink -f "$APP_DIR/current")"
fi

log "Unpacking release $SHA"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR"
rm -f "$TARBALL"

[ -f "$RELEASE_DIR/src/server.js" ] || { echo "release is missing src/server.js - aborting" >&2; rm -rf "$RELEASE_DIR"; exit 1; }
[ -d "$RELEASE_DIR/node_modules" ] || { echo "release is missing node_modules - aborting" >&2; rm -rf "$RELEASE_DIR"; exit 1; }

# Wire the release to state that must outlive it. Product and user images are
# written by multer to <release>/uploads/{products,users} and served from
# there by express.static, so without this symlink every deploy would orphan
# the images uploaded since the last one.
log "Linking shared .env and uploads"
rm -rf "$RELEASE_DIR/uploads"
ln -sfn "$SHARED_DIR/uploads" "$RELEASE_DIR/uploads"
ln -sfn "$SHARED_DIR/.env"    "$RELEASE_DIR/.env"

# Ship the PM2 config from the release to its stable path so config changes
# travel with the code.
cp "$RELEASE_DIR/deploy/ecosystem.config.js" "$ECOSYSTEM"

activate() {
  # ln -sfn + mv -T is an atomic rename; a plain `ln -sfn` onto an existing
  # symlink-to-directory would nest the link inside the old target instead.
  ln -sfn "$1" "$APP_DIR/.current.tmp"
  mv -Tf "$APP_DIR/.current.tmp" "$APP_DIR/current"
  # Fork mode, so this is a restart rather than a rolling reload: expect a
  # sub-second gap where sockets reconnect. The frontend's WebSocketContext
  # reconnects on its own; nothing is lost.
  pm2 startOrReload "$ECOSYSTEM" --update-env
}

healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 -o /dev/null "$HEALTH_URL"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log "Activating $SHA and reloading PM2"
activate "$RELEASE_DIR"

log "Health-checking $HEALTH_URL"
if healthy; then
  log "Release $SHA is live"
else
  echo "Health check failed for $SHA" >&2
  if [ -n "$PREVIOUS_DIR" ] && [ -d "$PREVIOUS_DIR" ]; then
    log "Rolling back to $(basename "$PREVIOUS_DIR")"
    cp "$PREVIOUS_DIR/deploy/ecosystem.config.js" "$ECOSYSTEM" 2>/dev/null || true
    activate "$PREVIOUS_DIR"
    healthy && log "Rollback succeeded - previous release is serving" \
            || echo "Rollback also failed health check - server needs attention" >&2
  else
    echo "No previous release to roll back to" >&2
  fi
  pm2 logs "$APP_NAME" --lines 50 --nostream || true
  exit 1
fi

# Keep the N most recent releases (by mtime) so rollback stays possible.
# Only the uploads/ and .env symlinks are removed with them - the real files
# live in shared/ and are never touched.
log "Pruning old releases (keeping $KEEP_RELEASES)"
cd "$APP_DIR/releases"
CURRENT_NAME="$(basename "$(readlink -f "$APP_DIR/current")")"
ls -1dt -- */ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
  old="${old%/}"
  [ "$old" = "$CURRENT_NAME" ] && continue
  rm -rf -- "$old"
done

pm2 save --force >/dev/null
log "Done"
