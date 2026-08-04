# Project State — Famto Backend

> Phase: **Stabilization** — stopping bleeding before any new features.
> Last updated: July 2026

---

## Codebase Metrics

| Metric | Value |
|--------|-------|
| JS files | 236 |
| Total LOC | ~68,500 |
| Models | 79 |
| Controllers | 65 |
| Route files | ~80+ |
| Largest file | `socket.js` — 5,066 lines |
| Largest controller | `universalOrderController.js` — 4,290 lines |
| Test coverage | **0%** |

---

## 🔴 P0 — Production-Crashing Bugs

| # | Problem | File | Detail |
|---|---------|------|--------|
| 1 | **Midnight cron missing 4 imports** | `index.js` | The scheduled cron job crashes because 4 required modules aren't imported. Runs nightly — each crash is silent unless monitored. |
| 2 | **DatabaseCounter no compound unique index** | `models/DatabaseCounter.js` | No unique compound index on `{collection, year, month}` → two concurrent requests can get the same counter value → duplicate custom string IDs → overwritten documents. |
| 3 | **autoAllocationRoute middleware order wrong** | `routes/adminRoute/autoAllocationRoute.js` | Auth middleware applied after route handler instead of before. Auth check never runs. |
| 4 | **appBannerRoute auth commented out** | `routes/adminRoute/appBannerRoute.js` | CRUD endpoints for app banners have `isAuthenticated` and `isAdmin` commented out. Anyone who can reach the endpoint can modify banners. |

---

## 🟠 P1 — Functional But Broken

| # | Problem | Scope |
|---|---------|-------|
| 1 | **7 schema bugs across model files** | ~7 files |
| | — `Category` uses `veg` but filter expects `Veg` (case mismatch) |
| | — `Merchant` model refs `Merchant` (self-loop, probably meant `MerchantAppCustomization`) |
| | — `CustomerCart` ref typo (wrong model name) |
| | — `ScheduledPickAndCustom` ID collides with `ScheduledOrder` format |
| | — `Geofence` unique constraint copy-pasted from another schema |
| | — Other minor schema issues |
| 2 | **WhatsApp dual webhook handlers** | `routes/whatsappRoute/` |
| | Two separate webhook endpoints processing the same incoming WhatsApp messages. Messages may be double-processed. |
| 3 | **268+ console.log in production code paths** | Throughout |
| | Node.js `console.log` is synchronous and blocks the event loop. Every log call adds latency to the request that triggers it. |
| 4 | **Coordinate `[lat,lng]` vs `[lng,lat]` inconsistency** | 6+ files |
| | GeoJSON spec requires `[longitude, latitude]`. Some places use `[lat, lng]`. Breaks geoqueries and map rendering. |
| 5 | **~40 models with zero indexes, no 2dsphere** | Most model files |
| | Every query on these collections does a full collection scan. Geoqueries on coordinates without `2dsphere` index fall back to slow in-memory calculation. |
| 6 | **No graceful shutdown** | `index.js` |
| | `SIGTERM`/`SIGINT` drops active connections. In-flight orders and payments may be lost during deploy/restart. |
| 7 | **Hardcoded Mappls API key in source** | `controllers/merchantController.js` lines 525, 1488 |
| | API key `9a632cda78b871b3a6eb69bddc470fef` burned into source code. Should use `process.env.MAPMYINDIA_API_KEY`. |
| 8 | **Global search product count is inflated** | `globalSearchController.js` lines 338-346, 437-471 |
| | `productCount` counts ALL products matching search (including those from merchants with expired/inactive pricing). But `enrichedProducts` drops products whose merchants fail the active-pricing check. So `totalProducts` in pagination metadata is inflated — client sees `totalPages: 3` but page 3 may return 0 results. Caused by counting before the enrichment filter. |

---

## 🔵 P2 — Tech Debt

| # | Problem |
|---|---------|
| 1 | V2 dead code still shipped (~21 route files + ~15 tagged files) |
| 2 | 4x duplicate `cartItemSchema` definition across model files |
| 3 | No `.lean()` calls on read-only Mongoose queries (2-5x slower per query) |
| 4 | N+1 query patterns (loop-based distance calculations, etc.) |
| 5 | **`totalPages` incorrectly shows 1 when total is 0** | `globalSearchController.js` L367-391 |
| | `Math.ceil(total / limit) || 1` — when total=0, `Math.ceil(0/limit)` = 0, `0||1` = 1. So empty results report `totalPages: 1`. |
| 6 | **Flutter client ignores pagination metadata** | `global_search_model.dart` L229-258 |
| | `GlobalSearchResult.fromJson` only parses `query`, `merchants`, `products`, `categories`, `businessCategories`. The `pagination` object from the API response is never read. Provider passes `limit: 8` but never sends `page`, so always gets page 1. |

---

## 🛑 Missing Foundations

### Service Layer — Missing
- Controllers do DB logic inline
- No repository/DAO pattern → hard to mock, hard to change DB
- Business rules (pricing, allocation, discount) mixed with HTTP concerns
- **No centralized order completion hook** — every creation path manages its own side-effects (bonus, notifications, wallet, analytics) inline and independently.

### API Contract — 0% Documented
- No OpenAPI/Swagger spec
- Flutter and React both reverse-engineer endpoints from backend code
- Breaking changes happen silently

### Pagination — Incompatible Shapes

| Format | Used By | Issue |
|--------|---------|-------|
| `{ pagination: { type: { total, page, limit, totalPages } }, data }` | Global Search ✅ | — |
| `{ totalDocuments, totalPages, currentPage, hasNextPage, hasPrevPage }` | Notifications ⚠️ | Different shape |
| `{ hasNextPage: bool, page, limit, data: [...] }` | Categories, Products ⚠️ | Incomplete |
| `{ message, data, pagination }` | Search Products in Merchant ✅ | Fixed Jul 2026 |
| `{ data, pagination }` | Filter & Sort Products ✅ | Fixed Jul 2026 — formerly bare array |
| `[array]` (bare, no metadata) | Orders, Restaurants, etc. ❌ | Unbounded growth |

---

## ₹50 Wallet Bonus — Coverage Map

### Where Bonus Fires

| Order Path | Model Created | Bonus? | Location |
|-----------|---------------|--------|----------|
| Agent completes order | `Order` | ✅ (completion-gated) | `agentController` L2403 |
| Admin marks order completed | `Order` | ✅ (completion-gated) | `adminOrderController` L3340 |
| Universal order creation | `Order`/`ScheduledOrder` | ⚠️ No-op since gate — status `Pending` at creation | `universalOrderController` L2461 |
| Pick&Drop → Famto-cash + Scheduled | `ScheduledPickAndCustom` | ⚠️ Silent no-op — see #4 | `pickAndDropController` L1729 |
| Admin cancel (clawback) | any | ✅ | `adminOrderController` L3432 |
| Merchant cancel (clawback) | any | ✅ | `merchantOrderController` L1240 |

> **Rule (2026-08-02):** bonus credits when `order.status === "Completed"` — NO payment-mode condition. COD/online/cash identical. `creditMilestoneBonus` no longer fires at order creation (`ProcessOrderService` call removed in `f36f653`; `universalOrderController` L2461 is a gated no-op).

### Gaps

| # | Priority | Gap | Detail |
|---|----------|-----|--------|
| A | **P0** | Pick&Drop + Online + Scheduled | `verifyPickAndDropPaymentController` creates `ScheduledPickAndCustom` directly — no `creditMilestoneBonus` call anywhere in handler L1907-2008 |
| B | **P0** | Admin `createOrder` (any type) | Admin panel order creation bypasses TemporaryOrder and writes directly — no bonus |
| C | **P0** | Merchant `createOrder` (any type) | Same as B, merchant-side order creation |
| 4 | **P1** | `resolveOrderObject` only queries `Order` — `ScheduledPickAndCustom` IDs return null | Helper does `Order.findById(stringId)`. ScheduledPickAndCustom IDs (format `SO2507XXX`) live in different collection → `findById` returns null → bonus silently skipped |
| 6 | **P1** | Response returns pre-bonus balance — `setImmediate` fires bonus *after* `res.json()` | Customer sees stale balance until re-fetch |
| 7 | ~~P1~~ **RESOLVED 2026-08-02** | COD order gets ₹50 bonus before payment collected — no customer-cancel clawback | Bonus is now completion-gated (`order.status === "Completed"`, all payment modes). A cancelled COD order never reaches Completed → no bonus to claw back. Customer cannot cancel a completed order; admin/merchant cancel still claw back (`adminOrderController` L3432, `merchantOrderController` L1240). |
| 8 | **P2** | Lost update race: concurrent qualifying orders read `walletBalance=0`, both write `0+50=50` | Uses read-modify-write instead of `$inc` |
| 9 | **P2** | `walletBalance.toFixed(2)` crashes on non-numeric wallet | No guard before `.toFixed()` |
| 10 | **P3** | `setImmediate` lost on restart/crash — no retry | Fire-and-forget has no persistence/retry |

### Root Cause

No centralized `orderCompleted()` hook. Every creation path calls its own chain of side-effects inline. Fix: create a single function that all 6 paths call → bonus + notifications + wallet + activity log.

---

## Development Notes

1. No `npm test` script exists yet.
2. Before changing any order completion path, check the bonus coverage map — all 6 paths must call `creditMilestoneBonus()`.
3. Coordinate convention: target `[lng, lat]` (GeoJSON spec). Currently mixed.

---

## What Was Fixed

- **Product search pagination (Jul 2026):** Both merchant-level product search endpoints now support pagination. `searchProductsInMerchantToOrderController` accepts `page`/`limit` params, runs parallel `countDocuments` + paginated `find()` with `.lean()`. `filterAndSortAndSearchProductsController` changed from bare array to `{ data, pagination }`. Previously unbounded endpoint now returns max 50 items per page. Docs at `work/docs/product-search-pagination.md`.
- **₹50 Wallet Bonus (Jul 2026):** `creditMilestoneBonus` wired into 4 of 6 order completion paths. Helper at `utils/firstOrderBonusHelper.js`: 50rs bonus, min order 300, one-time per customer, 3-state enum. Clawback in admin + merchant cancel paths. 3 gaps remain (A, B, C above).
- **₹50 Wallet Bonus — completion-gated (Aug 2, 2026):** bonus now credits strictly when `order.status === "Completed"` (agent or admin closes), all payment modes — removed the COD payment-collection gate. Trigger points: `agentController` L2403 + `adminOrderController` L3340. Payment-received endpoint is a pure flag-flip again. Clawback retained (admin cancel has no status guard — can cancel a completed order). Gap 7 resolved.
