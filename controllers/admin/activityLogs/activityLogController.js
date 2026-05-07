const ActivityLog = require("../../../models/ActivityLog");
const Customer = require("../../../models/Customer");
const Agent = require("../../../models/Agent");
const Merchant = require("../../../models/Merchant");

const appError = require("../../../utils/appError");
const { formatDate, formatTime } = require("../../../utils/formatters");

const getAllActivityLogsController = async (req, res, next) => {
  try {
    const filter = {};

    if (req.geofenceId && req.geofenceId.length > 0) {
      // Fetch all user IDs (customers, agents, merchants) within the manager's geofence
      const [customers, agents, merchants] = await Promise.all([
        Customer.find(
          { "customerDetails.geofenceId": { $in: req.geofenceId } },
          "_id"
        ).lean(),
        Agent.find(
          { geofenceId: { $in: req.geofenceId } },
          "_id"
        ).lean(),
        Merchant.find(
          { "merchantDetail.geofenceId": { $in: req.geofenceId } },
          "_id"
        ).lean(),
      ]);

      const geofenceUserIds = [
        ...customers.map((c) => c._id.toString()),
        ...agents.map((a) => a._id.toString()),
        ...merchants.map((m) => m._id.toString()),
      ];

      // Show geofence-scoped user logs AND all admin/manager action logs
      filter.$or = [
        { userId: { $in: geofenceUserIds } },
        { userType: { $nin: ["Customer", "Agent", "Merchant"] } },
      ];
    }

    const allLogs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const formattedResponse = allLogs.map((log) => ({
      date: formatDate(log.createdAt),
      time: formatTime(log.createdAt),
      description: log.description,
    }));

    res.status(200).json(formattedResponse);
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteOldActivityLogs = async () => {
  try {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    await ActivityLog.deleteMany({
      createdAt: { $lt: tenDaysAgo },
    });
  } catch (err) {
    throw new Error(`Error in deleting old activity logs: ${err}`);
  }
};

module.exports = {
  getAllActivityLogsController,
  deleteOldActivityLogs,
};
