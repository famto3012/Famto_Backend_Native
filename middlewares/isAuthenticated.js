const NodeCache = require("node-cache");
const appError = require("../utils/appError");
const getTokenFromHeader = require("../utils/getTokenFromHeaders");
const verifyToken = require("../utils/verifyToken");
const Manager = require("../models/Manager");

// Cache manager geofence IDs for 5 minutes to avoid DB hit on every request
const managerGeofenceCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

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
    const cacheKey = `manager_geofence_${decodedUser.id}`;
    let geofenceId = managerGeofenceCache.get(cacheKey);

    if (geofenceId === undefined) {
      const manager = await Manager.findById(decodedUser.id).select("geofenceId").lean();
      geofenceId = manager?.geofenceId || [];
      managerGeofenceCache.set(cacheKey, geofenceId);
    }

    req.geofenceId = geofenceId;
  }

  next();
};

// Call this whenever a manager's geofence is updated so cache is refreshed
const invalidateManagerGeofenceCache = (managerId) => {
  managerGeofenceCache.del(`manager_geofence_${managerId}`);
};

module.exports = isAuthenticated;
module.exports.invalidateManagerGeofenceCache = invalidateManagerGeofenceCache;
