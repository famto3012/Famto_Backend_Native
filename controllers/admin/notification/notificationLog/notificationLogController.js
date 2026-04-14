const appError = require("../../../../utils/appError");

const AdminNotificationLogs = require("../../../../models/AdminNotificationLog");
const MerchantNotificationLogs = require("../../../../models/MerchantNotificationLog");
const Merchant = require("../../../../models/Merchant");
const Order = require("../../../../models/Order");

const getAdminNotificationLogController = async (req, res, next) => {
  try {
    // Get page and limit from query parameters with default values
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    let filterCriteria = {};

    // If manager → show only notifications related to their geofence merchants
    if (req.geofenceId && req.geofenceId.length > 0) {
      // Step 1: Get merchants in manager's geofences
      const merchantsInGeofence = await Merchant.find({
        "merchantDetail.geofenceId": { $in: req.geofenceId },
      }).select("_id");

      const merchantIds = merchantsInGeofence.map((m) => m._id);

      // Step 2: Get order IDs for those merchants
      const ordersInGeofence = await Order.find({
        merchantId: { $in: merchantIds },
      }).select("_id");

      const orderIds = ordersInGeofence.map((o) => o._id.toString());

      // Step 3: Show notifications where orderId overlaps with geofence orders
      //         OR orderId is empty (push/alert notifications - broadcast to all managers)
      filterCriteria = {
        $or: [
          { orderId: { $elemMatch: { $in: orderIds } } },
          { orderId: { $size: 0 } },
          { orderId: { $exists: false } },
        ],
      };
    }

    // Find documents with pagination
    const [adminNotificationLog, totalDocuments] = await Promise.all([
      AdminNotificationLogs.find(filterCriteria)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
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

    // Find documents with pagination
    const merchantNotificationLog = await MerchantNotificationLogs.find({
      merchantId,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get the total count of documents
    const totalDocuments = await MerchantNotificationLogs.countDocuments({
      merchantId,
    });

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
