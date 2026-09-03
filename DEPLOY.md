# Deploying the church-cafe backend

Every push to `prod` builds on GitHub Actions and releases to the iv.lt VPS.

**The full guide — server provisioning, nginx, TLS, GitHub secrets — lives in
the frontend repo:**
<https://github.com/pug-bugger/my-church-cafe/blob/prod/DEPLOY.md>

One nginx site fronts both processes, so provisioning is done once, from there.
This file covers only what is specific to the backend.

```
push to prod
   └─ GitHub Actions (ubuntu-latest)
        ├─ npm ci --omit=dev            ← prod deps, built on Linux
        ├─ node --check every src/*.js  ← the only gate; no build, no tests
        ├─ tar src + node_modules + deploy + scripts
        └─ scp to the server
             └─ deploy/release.sh (on the server)
                  ├─ unpack to releases/<sha>
                  ├─ symlink shared/.env and shared/uploads into it
                  ├─ flip the `current` symlink atomically
                  ├─ pm2 startOrReload   ← fork mode, 1 instance
                  ├─ health-check http://127.0.0.1:4000/health
                  │    └─ on failure: flip back, reload, exit non-zero
                  └─ prune all but the 5 newest releases
```

Express listens on `127.0.0.1:4000` only. nginx forwards `/api/`, `/uploads/`,
`/socket.io/` and `/health` to it from the public domain; everything else goes
to the Next.js frontend on `:3100`. Same origin, so no cross-site CORS.

## Layout on the server

```
/var/www/church-cafe-backend/
├── current -> releases/2b4c77e…      # atomically swapped each deploy
├── ecosystem.config.js               # PM2 config, refreshed from each release
├── logs/{out,error}.log
├── shared/                           # OUTLIVES every release
│   ├── .env                          # secrets, mode 600, never in git
│   └── uploads/{products,users}/
└── releases/…                        # 5 kept, for rollback
```

### shared/ is load-bearing

`release.sh` symlinks both entries into every release directory:

- **`.env`** — `src/config/env.js` resolves it against `process.cwd()`, and PM2
  sets `cwd` to `current`. `release.sh` **refuses to deploy** if it is missing,
  because `env.js` would otherwise fall back to `JWT_SECRET=change_this_secret`
  and happily start signing forgeable tokens.
- **`uploads/`** — multer writes product and avatar images to
  `<release>/uploads/{products,users}` and `express.static` serves them from
  there. Without the symlink every deploy would orphan every image uploaded
  since the previous one.

The workflow deliberately excludes `uploads/` from the tarball, so the two
sample avatars tracked in git can't sit in the way of that symlink.

## Changing an environment variable

Edit it on the server; no redeploy needed.

```bash
sudo -u deploy nano /var/www/church-cafe-backend/shared/.env
pm2 restart church-cafe-backend
```

## Fork mode, one instance — on purpose

`deploy/ecosystem.config.js` sets `exec_mode: "fork"` and `instances: 1`. This
process keeps Socket.IO room state (`user:{id}`, `staff`) in memory. Cluster
mode would spread clients across workers that share nothing, so an
`order:statusUpdated` emitted by the worker handling the PATCH would never reach
a barista connected to the other one. It also owns the printer probe in
`src/lib/printerClient.js`, which would otherwise open one TCP connection per
worker every ~6 seconds.

Consequence: a deploy is a restart, not a rolling reload. Sockets drop for well
under a second and the frontend's `WebSocketContext` reconnects on its own.

Scaling past one instance needs `@socket.io/redis-adapter` first.

## The printer does not work from the VPS

`PRINTER_HOST` was `192.168.0.68` — a church-LAN address that a public server
cannot route to — so it is left unset in the provisioned `.env`. Printing is
best-effort by design: `POST /api/orders` still creates the order and emits
`printer:unavailable` to the `staff` room so someone writes the ticket by hand.

To restore it, put the VPS and a machine on the church LAN on the same overlay
network (Tailscale, WireGuard), then set `PRINTER_HOST` to the printer's address
on that network and restart.

## Database

`scripts/schema.sql` followed by the `migration_*.sql` files, in the order
listed in the main DEPLOY.md. They are plain `ALTER TABLE` statements and are
**not** idempotent — run each exactly once.

## Troubleshooting

```bash
pm2 status
pm2 logs church-cafe-backend --lines 100
curl -sS http://127.0.0.1:4000/health
ls -l /var/www/church-cafe-backend/current/          # .env + uploads symlinks
```

A release that fails its health check rolls itself back automatically and prints
the last 50 PM2 log lines into the Actions log.
