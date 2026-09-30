# Church Cafe Backend (Express + MySQL)

## Requirements

- Node.js 18+
- MySQL 8+

## Setup

1. Copy env example and edit values:
   cp env.example .env
2. Install dependencies:
   npm install
3. Create database and tables:
   mysql -u root -p < scripts/schema.sql
4. Run dev server:
   npm run dev

Server runs on http://localhost:4000

## API Overview

- Auth: `POST /api/auth/register`, `POST /api/auth/login`
- Users: `GET /api/users/me`, `PUT /api/users/me`, admin: `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`
- Categories: `GET /api/categories`, `GET /api/categories/:id`, admin: `POST /api/categories`, `PUT /api/categories/:id`, `DELETE /api/categories/:id`
- Products: `GET /api/products`, `GET /api/products/:id`, admin: `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`, `POST /api/products/:id/items`, `PUT /api/products/items/:itemId`, `DELETE /api/products/items/:itemId`, `POST /api/products/:id/options`, `PUT /api/products/options/:optionId`, `DELETE /api/products/options/:optionId`
- Orders: auth: `POST /api/orders` (items array; staff may add `customer_card` from a scanned card), `GET /api/orders/me`, `GET /api/orders/customer` (orders you are the customer of), `GET /api/orders/:id`; admin/staff: `GET /api/orders`, `PUT /api/orders/:id/status`
- Customer card: auth: `GET /api/card` (`{ code, qr }`, issued on first use), `POST /api/card/reset`; staff: `POST /api/card/resolve` (`{ code }` → `{ id, name, picture_url }`)
- Push: auth: `POST /api/push/token` (`{ token, platform, language }`), `DELETE /api/push/token` (`{ token }`). Pushes go out through the Expo Push Service when an order the user is the customer of becomes `ready`, is cancelled, or is deleted — see `src/lib/pushClient.js`.
- Version: `GET /api/version` — public; `{ name, version, env }`, the build that is answering. See `VERSIONING.md`.

Auth via Bearer token. Roles: `admin`, `personal`, `parishioner`.

## Realtime (Socket.IO)

This backend also exposes a Socket.IO server on the **same base URL/port** as the REST API.

- **Socket endpoint**: `http://localhost:4000` (default)
- **Path**: `/socket.io` (default)
- **Auth**: required (JWT). Send as `auth: { token }` or header `Authorization: Bearer <token>`.
- **Docs for frontend usage**: see `SOCKETS.md`

## Notes

- The version comes from `package.json` and is served at `/api/version`,
  `/health` and `/`. `VERSIONING.md` says when to change it.
- Passwords hashed with bcrypt.
- Totals calculated on order creation from current `product_items.price`.
- Deleting a product cascades to items/options via FK.
