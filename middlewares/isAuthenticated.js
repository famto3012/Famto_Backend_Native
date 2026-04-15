const appError = require("../utils/appError");
const getTokenFromHeader = require("../utils/getTokenFromHeaders");
const verifyToken = require("../utils/verifyToken");
const Manager = require("../models/Manager");

const isAuthenticated = async (req, res, next) => {
  const token = getTokenFromHeader(req);

  const decodedUser = verifyToken(token);

  if (!decodedUser) {
    return next(appError("Invalid / Expired token", 401));
  }

  req.userAuth = decodedUser.id;
  req.userRole = decodedUser.role;
  req.userName = decodedUser.name;

  // Only fetch geofenceId for Manager roles (not Admin, Agent, Merchant, Customer)
  if (
    decodedUser.role !== "Admin" &&
    decodedUser.role !== "Agent" &&
    decodedUser.role !== "Merchant" &&
    decodedUser.role !== "Customer"
  ) {
    const manager = await Manager.findById(decodedUser.id).select("geofenceId");
    req.geofenceId = manager?.geofenceId || [];
  }

  next();
};

module.exports = isAuthenticated;
