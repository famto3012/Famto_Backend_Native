const express = require("express");
const taskRoute = express.Router();
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isAdmin = require("../../../middlewares/isAdmin");
const {
  getTaskByIdController,
  assignAgentToTaskController,
  getAgentsAccordingToGeofenceController,
  getTasksController,
  getAgentsController,
  batchOrder,
} = require("../../../controllers/admin/deliveryManagement/taskController");

taskRoute.get(
  "/agents-in-geofence",
  isAdmin,
  isAuthenticated,
  getAgentsAccordingToGeofenceController
);

taskRoute.get("/task/:taskId", isAdmin, isAuthenticated, getTaskByIdController);

taskRoute.post(
  "/assign-task/:taskId",
  isAdmin,
  isAuthenticated,
  assignAgentToTaskController
);

taskRoute.get("/task-filter", isAdmin, isAuthenticated, getTasksController);

taskRoute.get("/agent-filter", isAdmin, isAuthenticated, getAgentsController);

taskRoute.get("/batch-order", isAdmin, isAuthenticated, batchOrder);

module.exports = taskRoute;
