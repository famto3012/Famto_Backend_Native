const express = require("express");
const { upload } = require("../../../utils/imageOperation");
const {
  createOrUpdateAgentCustomizationController,
  getAgentCustomizationController,
  getAgentWorkTimings,
  getAgentAppAppUpdateType,
} = require("../../../controllers/admin/appCustomization/agentAppCustomizationController");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isAdmin = require("../../../middlewares/isAdmin");
const {
  createOrUpdateMerchantCustomizationController,
  getMerchantCustomizationController,
  getMerchantAppAppUpdateType,
} = require("../../../controllers/admin/appCustomization/merchantAppCustomizationController");
const {
  createOrUpdateCustomerCustomizationController,
  getCustomerCustomizationController,
  getCustomerAppAppUpdateType,
} = require("../../../controllers/admin/appCustomization/customerAppCustomization");

const appCustomizationRoute = express.Router();

appCustomizationRoute.post(
  "/agent-app",
  upload.single("splashScreenImage"),
  isAuthenticated,
  isAdmin,
  createOrUpdateAgentCustomizationController
);

appCustomizationRoute.post(
  "/merchant-app",
  upload.single("splashScreenImage"),
  isAuthenticated,
  isAdmin,
  createOrUpdateMerchantCustomizationController
);

appCustomizationRoute.post(
  "/customer-app",
  upload.single("splashScreenImage"),
  isAuthenticated,
  isAdmin,
  createOrUpdateCustomerCustomizationController
);

appCustomizationRoute.get(
  "/agent-app",
  isAuthenticated,
  isAdmin,
  getAgentCustomizationController
);

appCustomizationRoute.get(
  "/merchant-app",
  isAuthenticated,
  isAdmin,
  getMerchantCustomizationController
);

appCustomizationRoute.get(
  "/customer-app",
  isAuthenticated,
  isAdmin,
  getCustomerCustomizationController
);

appCustomizationRoute.get(
  "/agent-app-timing",
  isAuthenticated,
  isAdmin,
  getAgentWorkTimings
);

appCustomizationRoute.get(
  "/customer-app-update-type",
  getCustomerAppAppUpdateType
);

appCustomizationRoute.get("/agent-app-update-type", getAgentAppAppUpdateType);

appCustomizationRoute.get(
  "/merchant-app-update-type",
  getMerchantAppAppUpdateType
);

module.exports = appCustomizationRoute;
