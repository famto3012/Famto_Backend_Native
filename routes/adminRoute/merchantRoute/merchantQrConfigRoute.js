const express = require("express");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isMerchant = require("../../../middlewares/isMerchant");

const {
  getMerchantQrConfigController,
  updateMerchantQrConfigController,
} = require("../../../controllers/admin/merchant/merchantQrConfigController");

const merchantQrConfigRoute = express.Router();

// Get the merchant's QR target config
merchantQrConfigRoute.get(
  "/qr-config",
  isAuthenticated,
  isMerchant,
  getMerchantQrConfigController
);

// Set the merchant's QR target URL (empty clears to fallback)
merchantQrConfigRoute.put(
  "/qr-config",
  isAuthenticated,
  isMerchant,
  updateMerchantQrConfigController
);

module.exports = merchantQrConfigRoute;
