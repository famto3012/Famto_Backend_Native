const express = require("express");
const isAdmin = require("../../../middlewares/isAdmin");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isMerchant = require("../../../middlewares/isMerchant");
const {
  getPlatformFeatureConfig,
  updatePlatformFeatureConfig,
  getMerchantFeatureOverrides,
  getMerchantFeatureOverride,
  upsertMerchantFeatureOverride,
  getMerchantFeatureConfig,
} = require("../../../controllers/admin/featureConfig/featureConfigController");

const featureConfigRoute = express.Router();

// Admin: Global feature config (singleton)
featureConfigRoute.get(
  "/",
  isAuthenticated,
  isAdmin,
  getPlatformFeatureConfig
);

featureConfigRoute.put(
  "/",
  isAuthenticated,
  isAdmin,
  updatePlatformFeatureConfig
);

// Admin: Merchant overrides list + per-merchant
featureConfigRoute.get(
  "/merchants",
  isAuthenticated,
  isAdmin,
  getMerchantFeatureOverrides
);

featureConfigRoute.get(
  "/merchant/:merchantId",
  isAuthenticated,
  isAdmin,
  getMerchantFeatureOverride
);

featureConfigRoute.put(
  "/merchant/:merchantId",
  isAuthenticated,
  isAdmin,
  upsertMerchantFeatureOverride
);

// Merchant: read effective config for UI gating.
// Mounted separately at /api/v1/merchants/feature-config (this router stays
// admin-only under /api/v1/admin/feature-config).
const merchantFeatureConfigRoute = express.Router();
merchantFeatureConfigRoute.get(
  "/",
  isAuthenticated,
  isMerchant,
  getMerchantFeatureConfig
);

module.exports = { featureConfigRoute, merchantFeatureConfigRoute };