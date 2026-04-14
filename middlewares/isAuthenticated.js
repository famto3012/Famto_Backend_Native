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

  // If user is a Manager (not Admin), attach their geofence IDs to req
  if (decodedUser.role !== "Admin") {
    const manager = await Manager.findById(decodedUser.id).select("geofenceId");
    req.geofenceId = manager?.geofenceId || [];
  }

  next();
};

module.exports = isAuthenticated;
