const appError = require("../../../../utils/appError");

const AdminNotificationLogs = require("../../../../models/AdminNotificationLog");
const MerchantNotificationLogs = require("../../../../models/MerchantNotificationLog");
const Merchant = require("../../../../models/Merchant");

const getAdminNotificationLogController = async (req, res, next) => {
  try {
    // Get page and limit from query parameters with default values
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    let filterCriteria = {};

    // If manager → show only notifications related to their geofence
    if (req.geofenceId && req.geofenceId.length > 0) {
      // Get merchants in manager's geofences
      const merchantsInGeofence = await Merchant.find(
        { "merchantDetail.geofenceId": { $in: req.geofenceId } },
        "_id"
      ).lean();
      // Convert to strings since merchantId is stored as String in the log
      const merchantIds = merchantsInGeofence.map((m) => m._id.toString());

      // Show:
      // 1. Order-related notifications → matched by merchantId (string)
      // 2. Push notifications → matched by geofenceId
      filterCriteria = {
        $or: [
          { merchantId: { $in: merchantIds } },
          { geofenceId: { $in: req.geofenceId } },
        ],
      };
    }

    // Find documents with pagination
    const [adminNotificationLog, totalDocuments] = await Promise.all([
      AdminNotificationLogs.find(filterCriteria)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminNotificationLogs.countDocuments(filterCriteria),
    ]);

    // Calculate total pages
    const totalPages = Math.ceil(totalDocuments / limit);

    res.status(200).json({
      data: adminNotificationLog,
      totalDocuments,
      totalPages,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getMerchantNotificationLogController = async (req, res, next) => {
  try {
    // Get page and limit from query parameters with default values
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const merchantId = req.userAuth;

    // Find documents with pagination — run both in parallel
    const [merchantNotificationLog, totalDocuments] = await Promise.all([
      MerchantNotificationLogs.find({ merchantId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MerchantNotificationLogs.countDocuments({ merchantId }),
    ]);

    // Calculate total pages
    const totalPages = Math.ceil(totalDocuments / limit);

    res.status(200).json({
      data: merchantNotificationLog,
      totalDocuments,
      totalPages,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getAdminNotificationLogController,
  getMerchantNotificationLogController,
};
