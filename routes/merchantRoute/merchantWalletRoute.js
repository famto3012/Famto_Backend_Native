const express = require("express");
const isAuthenticated = require("../../middlewares/isAuthenticated");
const isMerchant = require("../../middlewares/isMerchant");

const {
  getMerchantWallet,
  requestPayout,
} = require("../../controllers/merchant/merchantWalletController");

const merchantWalletRoute = express.Router();

merchantWalletRoute.get(
  "/wallet",
  isAuthenticated,
  isMerchant,
  getMerchantWallet
);

merchantWalletRoute.post(
  "/wallet/payout",
  isAuthenticated,
  isMerchant,
  requestPayout
);

module.exports = merchantWalletRoute;