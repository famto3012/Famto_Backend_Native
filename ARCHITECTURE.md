# Famto Backend — Architecture

> **Role:** REST + Socket.IO API server serving all clients (Flutter mobile app, React web ordering, React admin dashboard, WhatsApp bots).
> **Stack:** Node 20 · Express 4.21 · MongoDB (Mongoose 8.7) · Socket.IO 4.7 · JWT · Razorpay (India)

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
│                                   └──────────────────────┘  │
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
| Caching | node-cache | 5.1 |
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

### ADR-001: No Redis at Current Scale

**Decision:** Do not deploy Redis. All proposed use cases are served by in-process mechanisms:
- `node-cache` for hot data (faster than Redis at 0ms vs 0.3ms TCP round-trip)
- MongoDB TTL indexes for token blacklisting
- MemoryStore for rate limiting

**Revisit when:**
1. 2+ Node processes running (need Redis for socket.io adapter)
2. Single query exceeds 50ms due to collection size
3. Throughput exceeds ~500 RPS on read-heavy endpoints
4. Cross-service pub/sub needed (microservices)

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
| 7 | *Re-evaluate Redis* | Marginal after above |

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

---

## Network Architecture

### Ports

| Service | Port | Environment |
|---------|------|-------------|
| Express API | 8080 | Container (EXPOSE) |
| MongoDB | external | Atlas or VPS-hosted |
| Firebase | external | Google |

---

## Deployment

- **Runtime:** Docker container on own VPS (Alpine, Node 20)
- **Base image:** `node:20-alpine`
- **Port:** 8080
- **Cron jobs:** 5 scheduled in `index.js` (auto-cancellation, bonus processing, etc.)
- **Start command:** `node index.js --host 0.0.0.0`
- **No CI/CD** — manual `docker build` + `docker-compose pull/up` on VPS

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
