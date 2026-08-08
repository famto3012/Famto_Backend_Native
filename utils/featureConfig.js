const appError = require("./appError");

// Canonical defaults. Mirrors PlatformFeatureConfig defaults so the code and
// DB can't drift: a missing singleton doc is seeded from these on first read.
const DEFAULTS = {
  gateways: {
    razorpay: { enabled: true, sortOrder: 0 },
    cashfree: { enabled: true, sortOrder: 1 },
    phonepe: { enabled: true, sortOrder: 2 },
  },
  selfPaymentOption: true,
  whatsapp: true,
  delivery: true,
};

const GATEWAY_KEYS = ["razorpay", "cashfree", "phonepe"];

const PlatformFeatureConfig = require("../models/PlatformFeatureConfig");
const MerchantFeatureOverride = require("../models/MerchantFeatureOverride");

// ── In-process cache (60s TTL) ────────────────────────────────────────────
// Mirrors resolveMerchantConnection's cache in utils/whatsappApi.js.
const CACHE_TTL = 60_000;
const _cache = new Map(); // "__global" | "m:{merchantId}" -> { data, expiresAt }

const getPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Leaf may be a bare boolean (whatsapp/delivery/selfPaymentOption in the
// canonical shape) or an object with an `enabled` key (gateways). Resolve both.
const resolveLeaf = (value) => {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && typeof value.enabled === "boolean")
    return value.enabled;
  return undefined;
};

// Normalize the stored global singleton doc into the canonical shape
// (gateways keep {enabled,sortOrder}; the others are unwrapped booleans).
const canonicalGlobal = (raw) => ({
  gateways: Object.fromEntries(
    GATEWAY_KEYS.map((gw) => [
      gw,
      { ...DEFAULTS.gateways[gw], ...(raw?.gateways?.[gw] || {}) },
    ])
  ),
  selfPaymentOption:
    raw?.selfPaymentOption !== undefined
      ? raw.selfPaymentOption
      : DEFAULTS.selfPaymentOption,
  whatsapp:
    raw?.whatsapp?.enabled !== undefined
      ? raw.whatsapp.enabled
      : DEFAULTS.whatsapp,
  delivery:
    raw?.delivery?.enabled !== undefined
      ? raw.delivery.enabled
      : DEFAULTS.delivery,
});

// Normalize an override doc → only present fields; undefined = inherit global.
const canonicalOverride = (raw) => {
  if (!raw) return null;
  return {
    gateways: Object.fromEntries(
      GATEWAY_KEYS.map((gw) => [gw, raw.gateways?.[gw] || undefined])
    ),
    selfPaymentOption:
      raw.selfPaymentOption?.enabled !== undefined
        ? raw.selfPaymentOption.enabled
        : undefined,
    whatsapp: raw.whatsapp?.enabled,
    delivery: raw.delivery?.enabled,
  };
};

const cacheGet = (key) => {
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) _cache.delete(key);
  return undefined;
};

const cacheSet = (key, data) => {
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
};

const getGlobalConfig = async () => {
  const cached = cacheGet("__global");
  if (cached) return cached;
  let doc = await PlatformFeatureConfig.findOne({}).lean();
  if (!doc) {
    // Seed the singleton with defaults (all features enabled).
    doc = await PlatformFeatureConfig.create({
      gateways: {
        razorpay: { enabled: true, sortOrder: 0 },
        cashfree: { enabled: true, sortOrder: 1 },
        phonepe: { enabled: true, sortOrder: 2 },
      },
      selfPaymentOption: true,
      whatsapp: { enabled: true },
      delivery: { enabled: true },
    });
    doc = doc.toObject();
  }
  const canonical = canonicalGlobal(doc);
  cacheSet("__global", canonical);
  return canonical;
};

const getMerchantOverride = async (merchantId) => {
  if (!merchantId) return null;
  const key = `m:${String(merchantId)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const doc = await MerchantFeatureOverride.findOne({ merchantId }).lean();
  const canonical = canonicalOverride(doc);
  cacheSet(key, canonical);
  return canonical;
};

/**
 * Effective enabled state for a feature path.
 * Paths: "gateways.razorpay" | "gateways.cashfree" | "gateways.phonepe" |
 *        "selfPaymentOption" | "whatsapp" | "delivery"
 * Per-merchant override wins when present; else global default.
 */
const featureEnabled = async (featurePath, merchantId = null) => {
  const [globalCfg, override] = await Promise.all([
    getGlobalConfig(),
    getMerchantOverride(merchantId),
  ]);
  const overrideVal = resolveLeaf(override ? getPath(override, featurePath) : undefined);
  if (overrideVal !== undefined) return overrideVal;
  const globalVal = resolveLeaf(getPath(globalCfg, featurePath));
  return globalVal !== undefined ? globalVal : true;
};

// Convenience: list of enabled gateways for a merchant, ordered by sortOrder.
const availableGateways = async (merchantId) => {
  const [globalCfg, override] = await Promise.all([
    getGlobalConfig(),
    getMerchantOverride(merchantId),
  ]);
  return GATEWAY_KEYS.map((gw) => {
    const o = override?.gateways?.[gw];
    const g = globalCfg.gateways[gw];
    const enabled = resolveLeaf(o) ?? resolveLeaf(g);
    return {
      name: gw,
      enabled: enabled !== undefined ? enabled : true,
      sortOrder: g?.sortOrder ?? 0,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
};

// Full effective config for a merchant (merchant UI gating).
const getEffectiveConfig = async (merchantId) => {
  const [globalCfg, override] = await Promise.all([
    getGlobalConfig(),
    getMerchantOverride(merchantId),
  ]);
  const pick = (key) => {
    const o = override?.[key];
    const g = globalCfg[key];
    return resolveLeaf(o) ?? resolveLeaf(g);
  };
  return {
    gateways: await availableGateways(merchantId),
    selfPaymentOption: pick("selfPaymentOption") ?? true,
    whatsapp: pick("whatsapp") ?? true,
    delivery: pick("delivery") ?? true,
  };
};

const invalidateFeatureCache = (merchantId = null) => {
  if (merchantId) {
    _cache.delete(`m:${String(merchantId)}`);
  } else {
    // Global config changed — clear ALL cache including all merchant entries
    _cache.clear();
  }
};

/**
 * Express middleware — reject merchant-scoped routes for a disabled feature.
 * Uses req.merchantId (set by isMerchant). Example: requireFeature("whatsapp")
 */
const requireFeature = (featurePath) => async (req, res, next) => {
  try {
    const enabled = await featureEnabled(featurePath, req.merchantId || null);
    if (!enabled) {
      return next(appError(`${featurePath.split(".").pop()} feature is disabled`, 403));
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  DEFAULTS,
  GATEWAY_KEYS,
  getGlobalConfig,
  getMerchantOverride,
  getEffectiveConfig,
  availableGateways,
  featureEnabled,
  invalidateFeatureCache,
  requireFeature,
};
