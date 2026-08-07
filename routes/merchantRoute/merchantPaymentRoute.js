const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const isMerchant = require("../../middlewares/isMerchant");

const {
  getMerchantPaymentConfig,
  updateMerchantPaymentConfig,
  testMerchantPaymentConfig,
  disableMerchantPaymentConfig,
} = require("../../controllers/merchant/merchantPaymentController");

const merchantPaymentRoute = express.Router();

merchantPaymentRoute.get(
  "/payment-config",
  isAuthenticated,
  isMerchant,
  getMerchantPaymentConfig
);

merchantPaymentRoute.put(
  "/payment-config",
  isAuthenticated,
  isMerchant,
  updateMerchantPaymentConfig
);

merchantPaymentRoute.post(
  "/payment-config/test",
  isAuthenticated,
  isMerchant,
  testMerchantPaymentConfig
);

merchantPaymentRoute.delete(
  "/payment-config",
  isAuthenticated,
  isMerchant,
  disableMerchantPaymentConfig
);

module.exports = merchantPaymentRoute;