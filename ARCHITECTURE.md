# Famto Backend — Architecture

> **Role:** REST + Socket.IO API server serving all clients (Flutter mobile app, React web ordering, React admin dashboard, WhatsApp bots).
> **Stack:** Node 20 · Express 4.21 · MongoDB (Mongoose 8.7) · Socket.IO 4.7 · Redis 7.x · BullMQ · JWT · Razorpay (India)

---

## Quick Start

```bash
# Install
npm install

# Configuration
# Copy .env from your secrets manager or ask the CTO — needs:
#   MONGO_URI, FIREBASE_*, RAZORPAY_*, MAPMYINDIA_API_KEY, JWT_SECRET, etc.

# Run in dev (with nodemon)
npm run dev

# Run in production
npm start
```

**Port:** 8080 (EXPOSEd in Dockerfile, served on VPS behind nginx or direct).

---

## Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    VPS (own Linux host)                       │
│                                                              │
│  ┌──────────────────────────────────┐                        │
│  │  Express API (port 8080)         │◄──── REST + Socket.IO  │
│  │  Famto_Backend_Native/           │                        │
│  │  Node 20 · Alpine                │                        │
│  └──────┬───────────────────────────┘                        │
│         │                          ┌──────────────────────┐  │
│         ├──────────────────────────►  MongoDB (external)  │  │
│         │                          └──────────────────────┘  │
│         │                          ┌──────────────────────┐  │
│         ├──────────────────────────►  Firebase (external) │  │
│         │                          └──────────────────────┘  │
│         │                          ┌──────────────────────┐  │
│         └──────────────────────────►  Redis (internal)    │  │
│                                    │  Socket.IO adapter   │  │
│                                    │  BullMQ queues       │  │
│                                    │  Driver Geo storage  │  │
│                                    └──────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```
---

## Code Layout

```
index.js                  ← Entry point: routes + 5 cron jobs (711 lines)
├── config/                ← DB connect + Firebase init (admin + client SDKs)
├── models/                ← 79 Mongoose schemas
├── controllers/           ← 65 controllers (business logic + DB inline)
│   ├── admin/             ← 18 sub-controllers
│   ├── agent/
│   ├── customer/
│   └── whatsapp/
├── routes/                ← Route definitions per domain
│   ├── adminRoute/         ← 30+ route files
│   ├── agentRoute/
│   ├── customerRoute/
│   └── whatsappRoute/
├── middlewares/            ← Auth (JWT), validation (express-validator), error handling
├── utils/                  ← Shared helpers (order creation, bonus, formatting, maps)
├── libs/                   ← Cron jobs (automation.js, removeExpired.js)
├── socket/socket.js        ← Socket.IO handler (5,066 lines — largest file)
├── templates/              ← EJS (reset password, rejection)
└── DBSeeder/               ← Seed scripts (dev / staging)
```

### Key Files by Size

| File | Lines | Role |
|------|-------|------|
| `socket/socket.js` | 5,066 | Socket.IO event handling |
| `controllers/universalOrderController.js` | 4,290 | Main order CRUD |
| `controllers/adminOrderController.js` | 3,577 | Admin order management |
| `controllers/agentController.js` | 3,249 | Agent flow |
| `controllers/merchantOrderController.js` | 2,839 | Merchant order flow |
| `controllers/pickAndDropController.js` | 2,178 | P&D order flow |
| `utils/createOrderHelpers.js` | 2,200 | Order creation logic |
| `controllers/customerController.js` | 2,315 | Customer management |
| `utils/customerAppHelpers.js` | 1,338 | Customer app helpers |
| `utils/agentAppHelpers.js` | 948 | Agent app helpers |

---

## Roles

| Audience | Protocol | Purpose |
|----------|----------|---------|
| Flutter app (iOS/Android) | REST + Socket.IO | Customer ordering, tracking, payments |
| React web (famto_order_react) | REST | Browser-based ordering |
| Admin Dashboard (Famto_Dashboard) | REST + Socket.IO | Order management, CRM, WhatsApp |
| WhatsApp Business API | HTTP webhooks | Customer communication |
| Cron jobs (node-cron) | Internal | Auto-cancellation, bonus processing, analytics |

---

## Tech Stack

| Layer | Choice | Version |
|-------|--------|---------|
| Runtime | Node.js | 20 (Alpine Docker) |
| Framework | Express | 4.21 |
| Database | MongoDB via Mongoose | 8.7 |
| Auth | JWT (jsonwebtoken) | 9.x |
| Payments | Razorpay | India only |
| Realtime | Socket.IO | 4.7 |
| Push / Auth | Firebase Admin SDK + Firebase Client | 12.5 / 10.14 |
| Maps | @turf/turf | 7.1 |
| Scheduled tasks | node-cron | 3.x |
| File upload | multer | 1.4 |
| Templates | EJS | 3.1 |
| PDF generation | puppeteer | 23.5 |
| Image processing | sharp | 0.33 |
| Caching | Redis + node-cache | 7.x |
| Email | nodemailer | 6.9 |
| SMS/WhatsApp | axios | external API calls |
| Validation | express-validator | 7.2 |
| Logging | morgan + custom error logger | — |

---

## API Design

**Pattern:** REST + Socket.IO
- REST for CRUD operations
- Socket.IO for real-time order tracking + agent/customer chat
- JWT Bearer tokens for auth (from Firebase Auth or custom registration)
- Custom string IDs via `DatabaseCounter` model (not ObjectId or UUID)

**No service layer** — controllers call models directly. Business logic is mixed with HTTP concerns.

---

## Architecture Decisions

### ADR-001: Redis — Adopted (was "No Redis")

> **Status:** SUPERSEDED by ADR-003, ADR-004, and ADR-005 below.
> **Original reasoning:** In-process mechanisms (node-cache, MemoryStore, TTL indexes) were sufficient for single-process scale.
> **Trigger for reversal:** Need for horizontal scaling of Socket.IO, persistent background jobs, and cross-node driver location sharing.

**Decision:** Introduce Redis as a first-class infrastructural dependency. Redis powers:
- **Socket.IO adapter** (`@socket.io/redis-adapter`) — enables multiple Node processes to share real-time state
- **BullMQ** — replaces in-process `node-cron` polling with persistent, retryable job queues
- **Redis Geo** (`GEOADD` / `GEORADIUS`) — replaces in-memory `userSocketMap` for driver location storage

See ADR-003, ADR-004, ADR-005 for details per use case.

### ADR-002: Performance Priority Framework

All fixes are **free** (zero new infrastructure). Execute in order:

| # | Change | Expected Gain |
|---|--------|--------------|
| 1 | Add MongoDB indexes (~40 models missing them) + 2dsphere | 10-100x on collection scans |
| 2 | Add `.lean()` to all read-only Mongoose queries | 2-5x per query |
| 3 | Fix N+1 patterns (loop-based distance calculations) | Eliminates exponential DB load |
| 4 | Strip `console.log` from production code paths | Unblocks event loop (Node stdout is synchronous) |
| 5 | In-process rate limiting via express-rate-limit + MemoryStore | Abuse prevention |
| 6 | Token blacklist via MongoDB TTL index | Server-side JWT invalidation |
| 7 | *(Superseded — Redis adopted per ADR-001)* | — |

### ADR-003: Socket.IO Redis Adapter for Horizontal Scaling

**Decision:** Add `@socket.io/redis-adapter` and `ioredis` to the project. Attach the adapter to the existing Socket.IO server instance (socket/socket.js).

**Why:**
- `userSocketMap` lives in a single Node process's memory. Deploy/restart drops all connected sockets and their in-memory state.
- Without a shared adapter, only one Node process can serve WebSocket connections — you cannot horizontally scale the real-time layer.
- A Redis adapter lets Socket.IO broadcast events (`io.emit`) across all connected processes. Any process can emit to any socket, regardless of which process owns that socket.

**Revisit when:** Never (adapter is trivially cheap at ~$15/mo Redis instance and adds zero latency overhead vs. in-process for a single process).

**Trade-off:**
- New infrastructure dependency (Redis). Mitigation: Redis has near-zero downtime and the adapter is a well-maintained first-party Socket.IO package.
- Adds ~0.3ms TCP round-trip per event when a single process emits to a socket on another process. Events emitted to sockets on the same process stay local (no Redis hop).

### ADR-004: BullMQ for Background Jobs

**Decision:** Replace in-process `node-cron` polling with BullMQ (backed by the same Redis instance from ADR-003).

**Current problem:**
- All 8 cron schedules run inside the single Node process.
- The every-5-second `TemporaryOrder` poller (`*/5 * * * * *` in index.js) is lossy: if the process crashes between polls, unprocessed orders disappear.
- No retry mechanism — a job that fails mid-way is gone forever.
- If we run 2+ Node processes in the future, every process runs every cron → duplicate execution.

**Why BullMQ:**
- **Persistence:** Jobs survive process restarts and server crashes.
- **Delayed jobs:** Order timeout, auto-cancellation, and scheduled pickups expressed as delayed jobs instead of polling.
- **Workers:** Job processing runs in separate worker processes that can be scaled independently.
- **Deduplication:** BullMQ's job dedup (`jobId` option) prevents duplicate execution when multiple processes enqueue the same logical job.
- **Retries:** Built-in backoff and max attempts per job.

**What moves to BullMQ:**

| Current cron | Frequency | BullMQ pattern |
|-------------|-----------|----------------|
| TemporaryOrder processing | `*/5 * * * * *` (every 5s) | Queue worker + delayed job per order |
| Order auto-cancellation | `* * * * *` (every min) | Delayed job with TTL check |
| Automated status offlines | `0 6,12,18,0 * * *` (4x daily) | Cron-like repeatable job |
| Analytics rollup | `30 18 * * *` (daily) | Repeatable job |
| Invoice/statement generation | `* * * * *` (every min) | Queue per merchant |
| Other cron-based checks | various | Queue per domain |

**Trade-off:**
- Redis is a hard dependency for job processing (same instance as ADR-003, no extra cost).
- Worker processes add process-management complexity vs. simple `node-cron` inline schedules. Mitigation: start with the worker running inside the main process (BullMQ supports this), extract to separate workers when load demands.

### ADR-005: Driver Location Storage in Redis Geo

**Decision:** Move active driver locations from the in-memory `userSocketMap` object into Redis Geo structures.

**Current implementation (socket/socket.js):**
- `locationUpdated` event writes `[latitude, longitude]` to `userSocketMap[userId].location` (a plain JS object in-process).
- Customers poll via `agentLocationUpdateForUser` which reads from the same in-memory map.
- **Lost on every restart.** No historical location data. Only queryable from the one Node process that owns the map.

**Target architecture:**
| Operation | Redis Command | When |
|-----------|--------------|------|
| Store driver position | `GEOADD drivers:live <lng> <lat> <driverId>` | On every `locationUpdated` socket event |
| Query driver near point | `GEORADIUS drivers:live <lng> <lat> <radius> km` | Customer requests `agentLocationUpdateForUser` |
| Get single driver position | `GEOPOS drivers:live <driverId>` | Admin panel / order detail |
| Remove on disconnect | `ZREM drivers:live <driverId>` | On socket `disconnect` event |
| TTL cleanup | `EXPIRE drivers:live <ttl>` + periodic GEOSEARCHSTORE | Stale positions expire automatically |

**Why Redis Geo:**
- Survives restarts (Redis persistence/RDB snapshots).
- Queryable from any Node process (no single-process bottleneck).
- Built-in geospatial query (`GEORADIUS`) replaces manual distance-filtering in application code.
- Single-digit microsecond latency per operation.

**Trade-off:**
- Adds ~0.3ms TCP round-trip per location update. Mitigation: batch writes (e.g., update Redis every 5s, not on every client message) or use Redis pipelining.
- Existing `userSocketMap` also holds WebSocket socket IDs and FCM tokens — those stay in-process and cluster-local (they're ephemeral and tied to the specific Node process anyway). Redis Geo only replaces the **location** portion.

### Custom String IDs

`DatabaseCounter` model generates auto-incrementing IDs (e.g., `ORD2507001`, `SO2507001`) instead of MongoDB ObjectId. This means:
- Human-readable order IDs
- Sequential numbering by year/month
- **Risk:** no compound unique index → duplicate IDs under race conditions

### Order Lifecycle

```
TemporaryOrder → (cron polls every 5s) → Task + auto-allocation → Order/ScheduledOrder/ScheduledPickAndCustom
```

Orders land in a temporary collection first, then a cron job processes them into the permanent collection with agent auto-allocation.

### No Service Layer

Controllers handle HTTP concerns (parsing, validation, response) AND business logic (pricing, allocation, discount) AND database operations inline.

---

## Maps & Location Strategy

**Current provider:** Mappls (MapMyIndia) — Distance Matrix, Route Advanced, Static Map Image APIs.

**Problem:** No `MapService` abstraction — `getDistanceFromPickupToDelivery()` called directly from ~13 places. Raw URL interpolation, no caching, no circuit breaker, no fallback, no cost telemetry.

**Target architecture:** `MapService` interface with pluggable `MapplsProvider` / `MapboxProvider`, in-memory + Redis cache layer, circuit breaker, cost tracking.

See `MAP_SERVICE_STRATEGY.md` at project root for full evaluation.

---

## External Integrations

| Service | Purpose | Protocol | Credential Source |
|---------|---------|----------|-------------------|
| Firebase Auth + FCM | Phone OTP login, push notifications | REST SDK + Admin SDK | `.env` — `FIREBO_*` vars |
| Razorpay | Payment gateway (India only) | REST API | `.env` — `RAZORPAY_*` keys |
| Mappls/MapMyIndia | Maps, distance matrix, geocoding | REST API | `.env` (except hardcoded copy in `merchantController.js`) |
| WhatsApp Business API | Customer communication | Webhooks | `routes/whatsappRoute/` |
| SMTP (nodemailer) | Email notifications | SMTP | `.env` — SMTP creds |

### WhatsApp Template Send Flow (order tracking, campaigns)

Template messages are sent from `utils/whatsappApi.js` `sendTemplateMessage()` (single sends: order tracking, welcome, cart reminder) and `controllers/whatsapp/campaignController.js` `buildComponentsFromTemplate()` (campaign broadcasts). Both load the synced template from `WhatsappTemplate` and build Meta `components[]`.

Key rules (learned from prod incident 2026-07-31):
- **Header images:** Meta returns `header_handle` as an internal CDN handle wrapped in `@url:\`...\`` — this wrapper is **not** a valid `image.link` and must be stripped (`replace(/^@url:\`|\`$/g, '')`) before sending. Sending it verbatim makes Meta silently drop the message (200 OK + message ID, no delivery).
- **Language:** the payload `template.language.code` must match the template's synced `language` exactly (e.g. `en`), not a caller default. Mismatch breaks named-parameter resolution.
- **Named params:** `{{customer_name}}` requires `parameter_name` matching the template's declared names; positional `{{1}}` must NOT include `parameter_name`.
- **Message records:** every outbound `WhatsappMessage` requires a `conversationId` — find-or-create the `WhatsappConversation` by `waId` first (campaign path did this 2026-07-31).
- **Env config (deploy gap, 2026-07-31):** single sends read header images from `WHATSAPP_*_HEADER_IMAGE` env vars (`.env` / container). The production container was missing these three, so `sendTemplateMessage` fell back to `header_handle` and sent the invalid wrapper. **Deploy must set:** `WHATSAPP_WELCOME_HEADER_IMAGE`, `WHATSAPP_ORDER_TRACKING_HEADER_IMAGE`, `WHATSAPP_CART_REMINDER_HEADER_IMAGE` (Firebase Storage `@url:`-wrapped URLs are fine — code strips the wrapper).

---

## Network Architecture

### Ports

| Service | Port | Environment |
|---------|------|-------------|
| Express API | 8080 | Container (EXPOSE) |
| Redis | 6379 | Container or managed (same VPS) |
| MongoDB | external | Atlas or VPS-hosted |
| Firebase | external | Google |

---

## Deployment

- **Runtime:** Docker container on own VPS (Alpine, Node 20)
- **Base image:** `node:20-alpine`
- **Port:** 8080
- **Cron jobs:** 5 scheduled in `index.js` — targeted for migration to BullMQ (see ADR-004)
- **Start command:** `node index.js --host 0.0.0.0`
- **Background workers:** BullMQ workers process job queues (persistent, retryable)
- **No CI/CD** — manual `docker build` + deploy via SSH on VPS

---

## Testing

| Layer | Status |
|-------|--------|
| Unit tests (Layer 1) | **0%** — no test runner set up |
| Integration tests (Layer 2) | **0%** — no mongodb-memory-server |
| E2E tests (Layer 3) | **0%** |

**Target setup:** Vitest + mongodb-memory-server. First focus: `orderCompleted` hook + `firstOrderBonusHelper` unit tests, then controller sanity tests.

---

## CI/CD

**Dead.** No pipeline exists. Docker images built manually. Deploy via SSH + docker-compose.

**Target:** GitHub Actions: `lint → test → build → deploy staging → smoke test → deploy prod`.

---

## Configuration

**File:** `.env` (not committed, listed in `.gitignore`)
**Needs:** ~20+ environment variables including DB URI, Firebase creds, Razorpay keys, Mappls keys, JWT secret, SMTP settings.
