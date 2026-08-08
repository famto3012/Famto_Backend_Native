const express = require("express");
const taskRoute = express.Router();
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isAdmin = require("../../../middlewares/isAdmin");
const isMerchant = require("../../../middlewares/isMerchant");
const { requireFeature } = require("../../../utils/featureConfig");
const {
  getTaskByIdController,
  assignAgentToTaskController,
  getAgentsAccordingToGeofenceController,
  getTasksController,
  getAgentsController,
  batchOrder,
  testSocket,
} = require("../../../controllers/admin/deliveryManagement/taskController");
const {
  getMerchantTasksController,
  getMerchantAgentsController,
} = require("../../../controllers/admin/deliveryManagement/merchantTaskController");

taskRoute.get(
  "/agents-in-geofence",
  isAuthenticated,
  isAdmin,
  getAgentsAccordingToGeofenceController
);

taskRoute.get("/task/:taskId", isAuthenticated, isAdmin, getTaskByIdController);

taskRoute.post(
  "/assign-task/:taskId",
  isAuthenticated,
  isAdmin,
  assignAgentToTaskController
);

taskRoute.get("/task-filter", isAuthenticated, isAdmin, getTasksController);

taskRoute.get("/agent-filter", isAuthenticated, isAdmin, getAgentsController);

taskRoute.get(
  "/merchant/task-filter",
  isAuthenticated,
  isMerchant,
  requireFeature("delivery"),
  getMerchantTasksController
);

taskRoute.get(
  "/merchant/agent-filter",
  isAuthenticated,
  isMerchant,
  requireFeature("delivery"),
  getMerchantAgentsController
);

taskRoute.post("/batch-order", isAuthenticated, isAdmin, batchOrder);

taskRoute.post("/test-socket", isAuthenticated, isAdmin, testSocket);
module.exports = taskRoute;
