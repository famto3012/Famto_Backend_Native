const express = require("express");
const {
  addAgentByAdminController,
  editAgentByAdminController,
  getRatingsByCustomerController,
  filterAgentsController,
  approveAgentRegistrationController,
  rejectAgentRegistrationController,
  blockAgentController,
  approvePaymentController,
  filterAgentPayoutController,
  changeAgentStatusController,
  downloadAgentCSVController,
  fetchSingleAgentController,
  updateVehicleDetailController,
  downloadAgentPayoutCSVController,
} = require("../../../controllers/admin/agent/agentController");
const { upload } = require("../../../utils/imageOperation");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isAdmin = require("../../../middlewares/isAdmin");
const {
  addAgentByAdminValidations,
} = require("../../../middlewares/validators/agentValidation");

const adminAgentRoute = express.Router();

// Filter agent payout
adminAgentRoute.get(
  "/download-agent-csv",
  isAuthenticated,
  isAdmin,
  downloadAgentCSVController
);

adminAgentRoute.get(
  "/download-payment-csv",
  isAuthenticated,
  isAdmin,
  downloadAgentPayoutCSVController
);

// Filter agent payout
adminAgentRoute.get(
  "/filter-payment",
  isAuthenticated,
  isAdmin,
  filterAgentPayoutController
);

// Get Agent by vehicle type
adminAgentRoute.get(
  "/filter",
  isAuthenticated,
  isAdmin,
  filterAgentsController
);

// Get ratings of agent by customer
adminAgentRoute.get(
  "/:agentId/get-ratings-by-customer",
  isAuthenticated,
  isAdmin,
  getRatingsByCustomerController
);

// Get single agent
adminAgentRoute.get(
  "/:agentId",
  isAuthenticated,
  isAdmin,
  fetchSingleAgentController
);

// Add Agent by admin route
adminAgentRoute.post(
  "/add-agents",
  upload.fields([
    { name: "rcFrontImage", maxCount: 1 },
    { name: "rcBackImage", maxCount: 1 },
    { name: "aadharFrontImage", maxCount: 1 },
    { name: "aadharBackImage", maxCount: 1 },
    { name: "drivingLicenseFrontImage", maxCount: 1 },
    { name: "drivingLicenseBackImage", maxCount: 1 },
    { name: "agentImage", maxCount: 1 },
  ]),
  addAgentByAdminValidations,
  isAuthenticated,
  isAdmin,
  addAgentByAdminController
);

// Edit agent details by admin
adminAgentRoute.put(
  "/edit-agent/:agentId",
  upload.fields([
    // { name: "rcFrontImage", maxCount: 1 },
    // { name: "rcBackImage", maxCount: 1 },
    { name: "aadharFrontImage", maxCount: 1 },
    { name: "aadharBackImage", maxCount: 1 },
    { name: "drivingLicenseFrontImage", maxCount: 1 },
    { name: "drivingLicenseBackImage", maxCount: 1 },
    { name: "agentImage", maxCount: 1 },
  ]),
  // editAgentByAdminValidations,
  isAuthenticated,
  isAdmin,
  editAgentByAdminController
);

// Edit agent vehicle details by admin
adminAgentRoute.put(
  "/edit-agent-vehicle/:agentId/:vehicleId",
  upload.fields([
    { name: "rcFrontImage", maxCount: 1 },
    { name: "rcBackImage", maxCount: 1 },
  ]),
  isAuthenticated,
  isAdmin,
  updateVehicleDetailController
);

// Approve agent payout
adminAgentRoute.patch(
  "/approve-payout/:agentId/:detailId",
  isAuthenticated,
  isAdmin,
  approvePaymentController
);

// Change agent status
adminAgentRoute.patch(
  "/change-status/:agentId",
  isAuthenticated,
  isAdmin,
  changeAgentStatusController
);

// Approve registration
adminAgentRoute.patch(
  "/approve-registration/:agentId",
  isAuthenticated,
  isAdmin,
  approveAgentRegistrationController
);

// Block agent
adminAgentRoute.patch(
  "/block-agent/:agentId",
  isAuthenticated,
  isAdmin,
  blockAgentController
);

// Decline registration
adminAgentRoute.delete(
  "/reject-registration/:agentId",
  isAuthenticated,
  isAdmin,
  rejectAgentRegistrationController
);

module.exports = adminAgentRoute;
