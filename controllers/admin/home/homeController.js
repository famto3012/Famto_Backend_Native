const HomeScreenRealTimeData = require("../../../models/HomeScreenRealTimeData");
const HomeScreenRevenueData = require("../../../models/HomeScreenRevenueData");
const Order = require("../../../models/Order");
const Merchant = require("../../../models/Merchant");
const Agent = require("../../../models/Agent");
const CommissionLogs = require("../../../models/CommissionLog");
const SubscriptionLog = require("../../../models/SubscriptionLog");

const appError = require("../../../utils/appError");

const getHomeScreenRealTimeData = async (req, res, next) => {
  try {
    // If manager → compute live counts filtered by their geofences
    if (req.geofenceId && req.geofenceId.length > 0) {
      const geofenceIds = req.geofenceId;

      // Get merchants in the manager's geofences
      const merchantsInGeofence = await Merchant.find({
        "merchantDetail.geofenceId": { $in: geofenceIds },
        isBlocked: false,
      }).select("_id status merchantDetail").lean();

      const merchantIds = merchantsInGeofence.map((m) => m._id);

      // Orders filtered by merchants in geofence
      const [pending, ongoing, completed, cancelled] = await Promise.all([
        Order.countDocuments({
          merchantId: { $in: merchantIds },
          status: "Pending",
        }),
        Order.countDocuments({
          merchantId: { $in: merchantIds },
          status: { $in: ["On-going", "Accepted"] },
        }),
        Order.countDocuments({
          merchantId: { $in: merchantIds },
          status: "Completed",
        }),
        Order.countDocuments({
          merchantId: { $in: merchantIds },
          status: "Cancelled",
        }),
      ]);

      // Merchants counts in geofence
      const merchantOpen = merchantsInGeofence.filter(
        (m) => m.merchantDetail?.isOpen === true
      ).length;
      const merchantClosed = merchantsInGeofence.filter(
        (m) => m.merchantDetail?.isOpen === false
      ).length;
      const merchantActive = merchantsInGeofence.filter(
        (m) => m.status === "Active"
      ).length;
      const merchantInactive = merchantsInGeofence.filter(
        (m) => m.status === "Inactive"
      ).length;

      // Agents filtered by geofence
      const [agentFree, agentActive, agentInactive] = await Promise.all([
        Agent.countDocuments({
          geofenceId: { $in: geofenceIds },
          status: "Free",
          isBlocked: false,
          isApproved: "Approved",
        }),
        Agent.countDocuments({
          geofenceId: { $in: geofenceIds },
          status: "Busy",
          isBlocked: false,
          isApproved: "Approved",
        }),
        Agent.countDocuments({
          geofenceId: { $in: geofenceIds },
          status: "Inactive",
          isBlocked: false,
          isApproved: "Approved",
        }),
      ]);

      return res.status(200).json({
        order: { pending, ongoing, completed, cancelled },
        merchants: {
          open: merchantOpen,
          closed: merchantClosed,
          active: merchantActive,
          inactive: merchantInactive,
        },
        deliveryAgent: {
          free: agentFree,
          active: agentActive,
          inactive: agentInactive,
        },
      });
    }

    // Admin → return pre-computed global data
    const realTimeData = await HomeScreenRealTimeData.findOne().lean();

    if (!realTimeData) {
      return res.status(404).json({ message: "No real-time data found" });
    }

    res.status(200).json(realTimeData);
  } catch (err) {
    next(appError(err.message));
  }
};

const createHomeScreenRealTimeData = async (req, res, next) => {
  try {
    // Extract data from the request body
    const { order, merchants, deliveryAgent } = req.body;

    // Create a new HomeScreenRealTimeData instance
    const newRealTimeData = new HomeScreenRealTimeData({
      order,
      merchants,
      deliveryAgent,
    });

    // Save the new entry to the database
    await newRealTimeData.save();

    res.status(201).json({
      message: "Home screen real-time data created successfully",
      data: newRealTimeData,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// Helper: generate every date between start and end as "YYYY-MM-DD" keys with zero values
const buildFullDateRange = (start, end) => {
  const dayMap = {};
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (current <= last) {
    const key = current.toISOString().slice(0, 10); // "YYYY-MM-DD"
    dayMap[key] = {
      sales: 0,
      merchants: 0,
      commission: 0,
      subscription: 0,
      order: 0,
      createdAt: new Date(key),
    };
    current.setDate(current.getDate() + 1);
  }
  return dayMap;
};

const getRevenueDataByDateRange = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // If manager → compute live revenue from actual collections filtered by geofences
    if (req.geofenceId && req.geofenceId.length > 0) {
      const merchantsInGeofence = await Merchant.find({
        "merchantDetail.geofenceId": { $in: req.geofenceId },
      }).select("_id").lean();

      const merchantIds = merchantsInGeofence.map((m) => m._id);

      // Aggregate orders by day
      const [salesByDay, commissionByDay, subscriptionByDay, newMerchantsByDay] =
        await Promise.all([
          // Sales + order count per day
          Order.aggregate([
            {
              $match: {
                merchantId: { $in: merchantIds },
                status: { $ne: "Cancelled" },
                createdAt: { $gte: start, $lte: end },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "Asia/Kolkata",
                  },
                },
                sales: { $sum: "$billDetail.grandTotal" },
                order: { $sum: 1 },
              },
            },
          ]),

          // Commission per day
          CommissionLogs.aggregate([
            {
              $match: {
                merchantId: { $in: merchantIds },
                createdAt: { $gte: start, $lte: end },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "Asia/Kolkata",
                  },
                },
                commission: { $sum: "$payableAmountToFamto" },
              },
            },
          ]),

          // Subscriptions per day (userId = merchantId in SubscriptionLog)
          SubscriptionLog.aggregate([
            {
              $match: {
                userId: { $in: merchantIds.map((id) => id.toString()) },
                typeOfUser: "Merchant",
                paymentStatus: "Paid",
                createdAt: { $gte: start, $lte: end },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "Asia/Kolkata",
                  },
                },
                subscription: { $sum: "$amount" },
              },
            },
          ]),

          // New merchants per day (in geofence)
          Merchant.aggregate([
            {
              $match: {
                "merchantDetail.geofenceId": { $in: req.geofenceId },
                createdAt: { $gte: start, $lte: end },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "Asia/Kolkata",
                  },
                },
                merchants: { $sum: 1 },
              },
            },
          ]),
        ]);

      // Build full date range with zeros first
      const dayMap = buildFullDateRange(start, end);

      // Fill in actual data
      salesByDay.forEach(({ _id, sales, order }) => {
        if (dayMap[_id]) {
          dayMap[_id].sales = sales;
          dayMap[_id].order = order;
        }
      });
      commissionByDay.forEach(({ _id, commission }) => {
        if (dayMap[_id]) dayMap[_id].commission = commission;
      });
      subscriptionByDay.forEach(({ _id, subscription }) => {
        if (dayMap[_id]) dayMap[_id].subscription = subscription;
      });
      newMerchantsByDay.forEach(({ _id, merchants }) => {
        if (dayMap[_id]) dayMap[_id].merchants = merchants;
      });

      // Sort by date ascending for graph rendering
      const revenueData = Object.values(dayMap).sort(
        (a, b) => a.createdAt - b.createdAt
      );

      return res.status(200).json(revenueData);
    }

    // Admin → return pre-computed daily data, fill gaps with zeros
    const rawData = await HomeScreenRevenueData.find({
      createdAt: { $gte: start, $lte: end },
      userId: null,
    }).lean();

    // Build full date range with zeros
    const dayMap = buildFullDateRange(start, end);

    // Fill in pre-computed data
    rawData.forEach((entry) => {
      const key = new Date(entry.createdAt).toISOString().slice(0, 10);
      if (dayMap[key]) {
        dayMap[key].sales = entry.sales || 0;
        dayMap[key].merchants = entry.merchants || 0;
        dayMap[key].commission = entry.commission || 0;
        dayMap[key].subscription = entry.subscription || 0;
        dayMap[key].order = entry.order || 0;
      }
    });

    const revenueData = Object.values(dayMap).sort(
      (a, b) => a.createdAt - b.createdAt
    );

    res.status(200).json(revenueData);
  } catch (err) {
    next(appError(err.message));
  }
};

const getRevenueDataByDateRangeForMerchant = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Fetch data between the startDate and endDate
    const revenueData = await HomeScreenRevenueData.find({
      createdAt: { $gte: start, $lte: end },
      userId: req.userAuth,
    });

    res.status(200).json(revenueData);
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getHomeScreenRealTimeData,
  createHomeScreenRealTimeData,
  getRevenueDataByDateRange,
  getRevenueDataByDateRangeForMerchant,
};
