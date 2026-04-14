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
      const [customers, agents, merchants] = await Promise.all([
        Customer.find(
          { "customerDetails.geofenceId": { $in: req.geofenceId } },
          "_id"
        ),
        Agent.find({ geofenceId: { $in: req.geofenceId } }, "_id"),
        Merchant.find(
          { "merchantDetail.geofenceId": { $in: req.geofenceId } },
          "_id"
        ),
      ]);

      const userIds = [
        ...customers.map((c) => c._id.toString()),
        ...agents.map((a) => a._id.toString()),
        ...merchants.map((m) => m._id.toString()),
      ];

      filter.userId = { $in: userIds };
    }

    const allLogs = await ActivityLog.find(filter).sort({ createdAt: -1 });

    const formattedResponse = allLogs?.map((logs) => ({
      date: formatDate(logs.createdAt),
      time: formatTime(logs.createdAt),
      description: logs.description,
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
