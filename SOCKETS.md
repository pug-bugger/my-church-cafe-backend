# Socket.IO (Realtime) — Frontend Usage Guide

## Backend endpoint

- Base URL: `http://localhost:4000` (or your deployed API URL)
- Socket.IO path: `/socket.io` (default)
- Auth: **required** (JWT)

The backend will reject the connection if no token is provided.

## Events emitted by the backend

- `socket:ready`
  - Fired after connect/auth.
  - Payload: `{ userId, role }`

- `order:created`
  - Sent to:
    - staff users (`role` = `admin` or `personal`)
    - the user who created the order
  - Payload: `{ id, userId, total, status }`

- `order:statusUpdated`
  - Sent to:
    - staff users (`role` = `admin` or `personal`)
    - the user who owns the order
  - Payload: `{ id, userId, status }`

## Next.js setup (socket.io-client)

Install in your frontend project:

```bash
npm i socket.io-client
```

Add an env var in the frontend (example):

- `.env.local`

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Example: connect + listen (Client Component)

```ts
// app/_lib/socket.ts
import { io, type Socket } from "socket.io-client";

export function createSocket(token: string): Socket {
  const url = process.env.NEXT_PUBLIC_API_URL!;
  return io(url, {
    path: "/socket.io",
    transports: ["websocket"],
    auth: { token },
  });
}
```

```tsx
// app/(admin)/orders/OrdersLive.tsx
"use client";

import { useEffect } from "react";
import { createSocket } from "@/app/_lib/socket";

export default function OrdersLive({ token }: { token: string }) {
  useEffect(() => {
    const socket = createSocket(token);

    socket.on("connect", () => {
      console.log("socket connected", socket.id);
    });

    socket.on("socket:ready", (payload) => {
      console.log("socket ready", payload);
    });

    socket.on("order:created", (payload) => {
      console.log("order created", payload);
      // TODO: refetch orders or update local state
    });

    socket.on("order:statusUpdated", (payload) => {
      console.log("order status updated", payload);
      // TODO: update local state
    });

    socket.on("connect_error", (err) => {
      console.error("socket connect_error", err?.message);
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  return null;
}
```

## Notes / common pitfalls

- The backend requires a JWT. Connect **after login** (or reconnect when you obtain a token).
- If your frontend runs on a different origin, set `CORS_ORIGIN` in the backend `.env` (comma-separated list).
