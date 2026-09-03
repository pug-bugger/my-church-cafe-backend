// PM2 process definition for the church-cafe Express backend.
//
// Version-controlled here, shipped inside every release tarball, and copied to
// the stable path /var/www/church-cafe-backend/ecosystem.config.js by
// deploy/release.sh. PM2 always reads it from that stable path.
module.exports = {
  apps: [
    {
      name: "church-cafe-backend",

      // `cwd` is the release symlink. src/config/env.js resolves .env against
      // process.cwd(), and release.sh symlinks shared/.env into every release
      // directory, so this is what makes the secrets load.
      cwd: "/var/www/church-cafe-backend/current",
      script: "src/server.js",

      // FORK MODE, ONE INSTANCE - not cluster, unlike the frontend.
      //
      // This process holds Socket.IO state in memory: `user:{id}` and `staff`
      // rooms, plus the live connection for every barista tablet and the guest
      // orders board. Cluster mode would spread clients over workers that share
      // no room state, so an `order:statusUpdated` emitted by the worker that
      // handled the PATCH would never reach a barista connected to the other
      // one. Scaling out needs @socket.io/redis-adapter first.
      //
      // It also owns the printer probe in src/lib/printerClient.js, which would
      // otherwise open one TCP connection per worker every ~6 seconds.
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },

      // Long enough for in-flight requests and socket disconnects to settle.
      kill_timeout: 10000,
      listen_timeout: 10000,
      max_memory_restart: "400M",
      autorestart: true,

      error_file: "/var/www/church-cafe-backend/logs/error.log",
      out_file: "/var/www/church-cafe-backend/logs/out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
