const moment = require("moment-timezone");

const Agent = require("../../../models/Agent");
const Merchant = require("../../../models/Merchant");
const Order = require("../../../models/Order");
const Task = require("../../../models/Task");

const appError = require("../../../utils/appError");
const { getUserLocationFromSocket } = require("../../../socket/socket");

const getMerchantTasksController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    let { startDate, endDate, orderId, filter } = req.query;

    // Build the query object dynamically
    const query = {};

    // Add date range filter if provided
    if (startDate && endDate) {
      const start = moment.tz(startDate, "Asia/Kolkata");
      const end = moment.tz(endDate, "Asia/Kolkata");

      startDate = start.startOf("day").toDate();
      endDate = end.endOf("day").toDate();

      query.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // Add orderId filter if provided
    if (orderId) {
      query.orderId = { $regex: orderId, $options: "i" };
    }

    // Add taskStatus filter if provided
    if (filter) {
      query.taskStatus = filter;
    }

    // Restrict tasks to the merchant's own agents OR their own orders
    const [merchantAgents, merchantOrders] = await Promise.all([
      Agent.find({ merchantId }).select("_id"),
      Order.find({ merchantId }).select("_id"),
    ]);

    const agentIds = merchantAgents.map((a) => a._id);
    const orderIds = merchantOrders.map((o) => o._id);

    query.$or = [
      { agentId: { $in: agentIds } },
      { orderId: { $in: orderIds } },
    ];

    // Execute the query with optional population
    const tasks = await Task.find(query)
      .populate("agentId")
      .populate("orderId");

    // Send the response
    res.status(200).json({
      success: true,
      message: "Tasks fetched successfully",
      data: tasks,
    });
  } catch (err) {
    next(appError(err.message || "Failed to fetch tasks"));
  }
};

const getMerchantAgentsController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    const { name, geofenceStatus } = req.query;
    const isGeofenceEnabled = geofenceStatus === "true";

    const merchant = await Merchant.findById(merchantId).select(
      "merchantDetail.geofenceId"
    );

    if (!merchant) return next(appError("Merchant not found", 404));

    const geofenceId = merchant?.merchantDetail?.geofenceId;

    // Match Criteria
    const matchCriteria = {
      merchantId,
      isApproved: "Approved",
      isBlocked: false,
    };

    if (name?.trim()) {
      matchCriteria.fullName = { $regex: name.trim(), $options: "i" };
    }

    if (isGeofenceEnabled && geofenceId) {
      matchCriteria.geofenceId = geofenceId;
    }

    const agents = await Agent.find(matchCriteria).select(
      "fullName workStructure.tag status location"
    );

    const responseData = agents.map((agent) => {
      const agentLocation =
        getUserLocationFromSocket(agent._id) || agent.location;

      return {
        _id: agent._id,
        name: agent.fullName,
        workStructure: agent?.workStructure?.tag,
        status: agent.status,
        location: agentLocation,
      };
    });

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getMerchantTasksController,
  getMerchantAgentsController,
};
