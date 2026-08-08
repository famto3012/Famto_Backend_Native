const express = require("express");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isMerchant = require("../../../middlewares/isMerchant");

const {
  getMerchantAnalyticsSummaryController,
  getMerchantOrderTrendController,
  getMerchantTopCustomersController,
  getMerchantTopProductsController,
  getMerchantDeliveryPerformanceController,
} = require("../../../controllers/admin/merchant/merchantAnalyticsController");

const merchantAnalyticsRoute = express.Router();

// Summary cards (revenue/orders/AOV/rating + customer cohort)
merchantAnalyticsRoute.get(
  "/analytics/summary",
  isAuthenticated,
  isMerchant,
  getMerchantAnalyticsSummaryController
);

// Orders + revenue time series (interval=day|week|month)
merchantAnalyticsRoute.get(
  "/analytics/order-trend",
  isAuthenticated,
  isMerchant,
  getMerchantOrderTrendController
);

// Top-spender customers (paged) for the period
merchantAnalyticsRoute.get(
  "/analytics/customers",
  isAuthenticated,
  isMerchant,
  getMerchantTopCustomersController
);

// Top products by revenue
merchantAnalyticsRoute.get(
  "/analytics/products",
  isAuthenticated,
  isMerchant,
  getMerchantTopProductsController
);

// Delivery performance + top agents
merchantAnalyticsRoute.get(
  "/analytics/delivery",
  isAuthenticated,
  isMerchant,
  getMerchantDeliveryPerformanceController
);

module.exports = merchantAnalyticsRoute;
