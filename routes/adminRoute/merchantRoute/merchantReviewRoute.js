const express = require("express");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isMerchant = require("../../../middlewares/isMerchant");

const {
  getMerchantReviewsController,
  replyToMerchantReviewController,
} = require("../../../controllers/admin/merchant/merchantReviewController");

const merchantReviewRoute = express.Router();

// List own reviews (merchant-scoped)
merchantReviewRoute.get(
  "/reviews",
  isAuthenticated,
  isMerchant,
  getMerchantReviewsController
);

// Reply to a customer's review
merchantReviewRoute.patch(
  "/reviews/:customerId/reply",
  isAuthenticated,
  isMerchant,
  replyToMerchantReviewController
);

module.exports = merchantReviewRoute;
