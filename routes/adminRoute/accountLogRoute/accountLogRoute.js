const express = require("express");
const isAuthenticated = require("../../../middlewares/isAuthenticated");
const isAdmin = require("../../../middlewares/isAdmin");
const {
  unBlockUserController,
  filterUserInAccountLogs,
  downloadUserCSVInAccountLogs,
} = require("../../../controllers/admin/accountLogs/accountLogsController");

const accountLogRoute = express.Router();

accountLogRoute.get(
  "/filter",
  isAuthenticated,
  isAdmin,
  filterUserInAccountLogs
);

accountLogRoute.get(
  "/csv",
  isAuthenticated,
  isAdmin,
  downloadUserCSVInAccountLogs
);

accountLogRoute.put(
  "/unblock-user/:logId",
  isAuthenticated,
  isAdmin,
  unBlockUserController
);

module.exports = accountLogRoute;
