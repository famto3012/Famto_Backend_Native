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

taskRoute.post("/batch-order", isAuthenticated, isAdmin, batchOrder);

module.exports = taskRoute;
