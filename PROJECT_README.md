# Famto Backend — Monolithic API Server

> **Role:** REST + Socket.IO API server serving all clients (Flutter mobile app, React web ordering, React admin dashboard, WhatsApp bots).
> **Location:** `Famto_Backend_Native/`
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

## Architecture (at a glance)

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

### Key structural facts

| Metric | Value |
|--------|-------|
| JavaScript files | 236 |
| LOC | ~68,500 |
| Models | 79 |
| Controllers | 65 |
| Largest file | `socket.js` — 5,066 lines |
| Largest controller | `universalOrderController.js` — 4,240 lines |
| Test coverage | **0%** |
| Service layer | **None** — controllers call models directly |

---

## API Contract

**No OpenAPI/Swagger spec exists.** Both Flutter and React reverse-engineer endpoints from the backend code. Breaking changes are silent until runtime.

**Pagination:** 4 incompatible response shapes across endpoints. See `PROJECT_STATE.md → Pagination Inconsistency` for the full audit. Target envelope:

```json
{
  "data": [...],
  "pagination": {
    "total": 154, "page": 1, "limit": 20,
    "totalPages": 8, "hasNextPage": true, "hasPrevPage": false
  }
}
```

---

## Known Structural Problems

### 🔴 P0 — Production-Crashing

| # | Problem | File | Status |
|---|---------|------|--------|
| 1 | Midnight cron missing 4 imports → crashes nightly | `index.js` | **Open** |
| 2 | `DatabaseCounter` no compound unique index → duplicate custom IDs under race | `models/DatabaseCounter.js` | **Open** |
| 3 | `autoAllocationRoute` middleware order wrong — auth runs before route handler | `routes/adminRoute/autoAllocationRoute.js` | **Open** |
| 4 | `appBannerRoute` CRUD auth **commented out** — anyone can modify banners | `routes/adminRoute/appBannerRoute.js` | **Open** |

### 🟠 P1 — Functional But Broken

| # | Problem | Scope |
|---|---------|-------|
| 1 | 7 schema bugs (ref typos, `veg`≠`Veg` default mismatch, `Merchant` refss `Merchant`, `CustomerCart` ref typo, `ScheduledPickAndCustom` ID collision, `Geofence` unique copy-paste) | ~7 model files |
| 2 | WhatsApp dual webhook handlers processing same incoming messages | `routes/whatsappRoute/` |
| 3 | 268+ `console.log` in production code paths (blocks event loop — Node stdout is synchronous) | Throughout |
| 4 | Coordinate `[lat,lng]` vs `[lng,lat]` inconsistency in 6+ files (GeoJSON spec requires `[lng, lat]`) | Utils, controllers, helpers |
| 5 | ~40 models with **zero indexes**, no `2dsphere` for geoqueries | Most model files |
| 6 | No graceful shutdown — `SIGTERM` drops connections | `index.js` |
| 7 | Hardcoded Mappls API key in `merchantController.js` lines 525, 1488 | Security leak in source |

### 🔵 P2 — Tech Debt

| # | Problem |
|---|---------|
| 1 | V2 dead code (~21 routes + ~15 tagged files) still shipped |
| 2 | 4x duplicate `cartItemSchema` definition across models |

---

## Architecture Decisions

### ADR-001: No Redis at Current Scale

**Decision:** Do not deploy Redis. All proposed use cases served by in-process mechanisms (node-cache, MongoDB TTL indexes, MemoryStore rate limiting).

**Revisit when:**
1. 2+ Node processes running (need Redis for socket.io adapter)
2. Single query exceeds 50ms
3. Throughput exceeds ~500 RPS on read-heavy endpoints
4. Cross-service pub/sub needed (microservices)

### ADR-002: Performance Priority Framework

All fixes are **free** (zero new infrastructure). Execute in order:

| # | Change | Expected Gain |
|---|--------|--------------|
| 1 | Add MongoDB indexes (~40 models) + 2dsphere | 10-100x on collection scans |
| 2 | Add `.lean()` to all read-only Mongoose queries | 2-5x per query |
| 3 | Fix N+1 patterns (loop-based distance calcs) | Eliminates exponential DB load |
| 4 | Strip 268+ `console.log` from prod paths | Unblocks event loop |
| 5 | In-process rate limiting (express-rate-limit + MemoryStore) | Abuse prevention |
| 6 | Token blacklist via MongoDB TTL index | Server-side JWT invalidation |
| 7 | Re-evaluate Redis | Marginal after above |

---

## ₹50 Wallet Bonus — Coverage Map

The `creditMilestoneBonus()` fires on **most** but not all order completion paths. Known gaps:

| Gap | Path | Status |
|-----|------|--------|
| **A** | Pick&Drop + Online + Scheduled → `ScheduledPickAndCustom` | ❌ **No bonus call** |
| **B** | Admin `createOrder` (any type) | ❌ **No bonus call** |
| **C** | Merchant `createOrder` (any type) | ❌ **No bonus call** |

Bonus helper at `utils/firstOrderBonusHelper.js`: ₹50 bonus, min order ₹300, one-time per customer, 3-state enum.

---

## Maps & Location Strategy

**Current provider:** Mappls (MapMyIndia) — Distance Matrix, Route Advanced, Static Map Image APIs.

**Problem:** No `MapService` abstraction — `getDistanceFromPickupToDelivery()` called directly from ~13 places. Raw URL interpolation, no caching, no circuit breaker, no fallback, no cost telemetry.

**Target architecture:** `MapService` interface with pluggable `MapplsProvider` / `MapboxProvider`, in-memory + Redis cache layer, circuit breaker, cost tracking.

See `MAP_SERVICE_STRATEGY.md` at project root for full evaluation.

---

## Testing

| Layer | Status |
|-------|--------|
| Unit tests (Layer 1) | **0%** — no test runner set up |
| Integration tests (Layer 2) | **0%** — no mongodb-memory-server |
| E2E tests (Layer 3) | **0%** |

**Target setup:** Vitest + mongodb-memory-server for backend tests. First focus: `orderCompleted` hook + `firstOrderBonusHelper` unit tests, then controller sanity tests.

---

## CI/CD

**Dead.** No pipeline exists. Docker images built manually. Deploy via SSH + docker-compose.

**Target:** GitHub Actions: `lint → test → build → deploy staging → smoke test → deploy prod`.

---

## External Integrations

| Service | Purpose | Credential Source |
|---------|---------|-------------------|
| Firebase Auth + FCM | Phone OTP login, push notifications | `.env` — `FIREBO_*` vars |
| Razorpay | Payment gateway (India only) | `.env` — `RAZORPAY_*` keys |
| Mappls/MapMyIndia | Maps, distance matrix, geocoding | `.env` (except hardcoded copy in `merchantController.js`) |
| WhatsApp Business API | Customer communication | `routes/whatsappRoute/` |
| SMTP (nodemailer) | Email notifications | `.env` — SMTP creds |

---

## Configuration

**File:** `.env` (not committed, listed in `.gitignore`)
**Needs:** ~20+ environment variables including DB URI, Firebase creds, Razorpay keys, Mappls keys, JWT secret, SMTP settings.

---

## Deployment

- **Runtime:** Docker container on own VPS (Alpine, Node 20)
- **Port:** 8080
- **Cron jobs:** 5 scheduled in `index.js` (auto-cancellation, bonus processing, etc.)
- **Start command:** `node index.js --host 0.0.0.0`
- **No CI/CD** — manual `docker build` + `docker-compose pull/up` on VPS

---

## ⚠️ Development Notes

1. No `npm test` script exists yet.
2. Review `PROJECT_STATE.md` at the `work/` root for the full bug tracker, pagination audit, bonus audit, and architecture decision log.
3. Before changing any order completion path, check the bonus coverage map — all 6 paths must call `creditMilestoneBonus()`.
4. Coordinate convention: target `[lng, lat]` (GeoJSON spec). Currently mixed.
