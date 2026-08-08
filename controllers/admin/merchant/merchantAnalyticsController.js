const Order = require("../../../models/Order");
const Customer = require("../../../models/Customer");
const Merchant = require("../../../models/Merchant");
const Agent = require("../../../models/Agent");
const appError = require("../../../utils/appError");

// ---------------------------------------------------------------------------
// Merchant-scoped analytics (Phase 7). Every query is filtered by
// req.merchantId (set by the isMerchant middleware). All aggregates reuse the
// homeController.js pattern: Asia/Kolkata date bucketing, Cancelled orders
// excluded from revenue/spend, `billDetail.grandTotal` as the sales figure.
// ---------------------------------------------------------------------------

const IST = "Asia/Kolkata";

// Default window = last 30 days when no range is given.
const resolveDateRange = (req) => {
  const now = new Date();
  let start = req.query.startDate ? new Date(req.query.startDate) : null;
  let end = req.query.endDate ? new Date(req.query.endDate) : null;

  if (Number.isNaN(start)) start = null;
  if (Number.isNaN(end)) end = null;

  if (!end) end = new Date(now);
  end.setHours(23, 59, 59, 999);

  // Only derive the default window when the caller omitted a start date.
  if (!start) {
    start = new Date(end);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }

  if (start > end) [start, end] = [end, start];
  return { start, end };
};

// "YYYY-MM-DD" of a date as seen in India (matches $dateToString timezone).
const istDayKey = (d) =>
  d.toLocaleDateString("en-CA", { timeZone: IST });

// Numeric helpers — 0 for empty aggregates.
const countOf = (res, field) => res?.[0]?.[field] ?? 0;
// $facet pipelines return { field: [{ count: N }] }.
const facetCount = (res, field) => res?.[0]?.[field]?.[0]?.count ?? 0;

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// GET /analytics/summary
// Headline cards: revenue, orders, AOV, rating + customer cohort numbers.
// ---------------------------------------------------------------------------
const getMerchantAnalyticsSummaryController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { start, end } = resolveDateRange(req);
    const range = { $gte: start, $lte: end };

    const [orderStats, customerCohort, merchant] = await Promise.all([
      // Order-level totals for the period
      Order.aggregate([
        { $match: { merchantId, createdAt: range } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: {
              $sum: {
                $cond: [
                  { $ne: ["$status", "Cancelled"] },
                  { $ifNull: ["$billDetail.grandTotal", 0] },
                  0,
                ],
              },
            },
            pendingOrders: {
              $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] },
            },
            ongoingOrders: {
              $sum: {
                $cond: [{ $in: ["$status", ["On-going", "Accepted"]] }, 1, 0],
              },
            },
            completedOrders: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
            cancelledOrders: {
              $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] },
            },
          },
        },
      ]),

      // Customer cohort: total / new (first order in window) /
      // active (ordered in window) / repeat (2+ orders in window)
      (async () => {
        const [allTime, active] = await Promise.all([
          Order.aggregate([
            { $match: { merchantId } },
            {
              $group: {
                _id: "$customerId",
                firstOrderAt: { $min: "$createdAt" },
              },
            },
            {
              $facet: {
                totalCustomers: [{ $count: "count" }],
                newCustomers: [
                  { $match: { firstOrderAt: range } },
                  { $count: "count" },
                ],
              },
            },
          ]),
          Order.aggregate([
            {
              $match: {
                merchantId,
                status: { $ne: "Cancelled" },
                createdAt: range,
              },
            },
            { $group: { _id: "$customerId", n: { $sum: 1 } } },
            {
              $facet: {
                activeCustomers: [{ $count: "count" }],
                repeatCustomers: [
                  { $match: { n: { $gte: 2 } } },
                  { $count: "count" },
                ],
              },
            },
          ]),
        ]);
        return {
          totalCustomers: facetCount(allTime, "totalCustomers"),
          newCustomers: facetCount(allTime, "newCustomers"),
          activeCustomers: facetCount(active, "activeCustomers"),
          repeatCustomers: facetCount(active, "repeatCustomers"),
        };
      })(),

      Merchant.findById(merchantId)
        .select("merchantDetail.ratingByCustomers")
        .lean(),
    ]);

    const s = orderStats[0] || {};
    const totalOrders = s.totalOrders || 0;
    const totalRevenue = round2(s.totalRevenue || 0);
    const avgOrderValue = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0;

    const reviews = merchant?.merchantDetail?.ratingByCustomers || [];
    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? Math.round(
            (reviews.reduce((acc, r) => acc + (r.rating || 0), 0) /
              totalReviews) *
              10
          ) /
          10
        : 0;

    const activeCustomers = customerCohort.activeCustomers || 0;
    const repeatRate =
      activeCustomers > 0
        ? Math.round((customerCohort.repeatCustomers / activeCustomers) * 1000) /
          10
        : 0;

    res.status(200).json({
      success: true,
      period: { startDate: start, endDate: end },
      overview: {
        totalRevenue,
        totalOrders,
        avgOrderValue,
        pendingOrders: s.pendingOrders || 0,
        ongoingOrders: s.ongoingOrders || 0,
        completedOrders: s.completedOrders || 0,
        cancelledOrders: s.cancelledOrders || 0,
        averageRating,
        totalReviews,
      },
      customers: {
        totalCustomers: customerCohort.totalCustomers || 0,
        activeCustomers,
        newCustomers: customerCohort.newCustomers || 0,
        repeatCustomers: customerCohort.repeatCustomers || 0,
        repeatRate,
      },
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// ---------------------------------------------------------------------------
// GET /analytics/order-trend?interval=day|week|month
// Orders + revenue per period for the line/bar chart. Day buckets come from
// Mongo; week/month re-bucketing and zero-gap filling happen here.
// ---------------------------------------------------------------------------
const getMerchantOrderTrendController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { start, end } = resolveDateRange(req);
    const interval = ["day", "week", "month"].includes(req.query.interval)
      ? req.query.interval
      : "day";

    const dayBuckets = await Order.aggregate([
      {
        $match: {
          merchantId,
          status: { $ne: "Cancelled" },
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: IST },
          },
          orders: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$billDetail.grandTotal", 0] } },
        },
      },
    ]);

    const dayMap = new Map(dayBuckets.map((b) => [b._id, b]));

    // Label + bucket key for a given day
    const bucketKeyFor = (date) => {
      const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      if (interval === "day") return istDayKey(d);
      if (interval === "month") return istDayKey(d).slice(0, 7);
      // week -> Monday of that week (key = that Monday's date)
      const day = (d.getUTCDay() + 6) % 7; // Mon=0
      d.setUTCDate(d.getUTCDate() - day);
      return istDayKey(d);
    };

    const buckets = new Map();
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = bucketKeyFor(cursor);
      const day = dayMap.get(istDayKey(cursor));
      const current = buckets.get(key) || { key, orders: 0, revenue: 0 };
      current.orders += day?.orders || 0;
      current.revenue += day?.revenue || 0;
      buckets.set(key, current);

      cursor.setDate(cursor.getDate() + 1);
    }

    const trend = [...buckets.values()].sort((a, b) =>
      a.key.localeCompare(b.key)
    );

    res.status(200).json({
      success: true,
      interval,
      trend,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// ---------------------------------------------------------------------------
// GET /analytics/customers?page=&limit=
// Top spenders for the period, with customer info joined manually (the
// Order.customerId ref is a plain string, same $in pattern as reviews).
// ---------------------------------------------------------------------------
const getMerchantTopCustomersController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { start, end } = resolveDateRange(req);

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100
    );

    const [totalAgg, rows] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            merchantId,
            status: { $ne: "Cancelled" },
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: "$customerId" } },
        { $count: "count" },
      ]),
      Order.aggregate([
        {
          $match: {
            merchantId,
            status: { $ne: "Cancelled" },
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: "$customerId",
            orders: { $sum: 1 },
            totalSpent: { $sum: { $ifNull: ["$billDetail.grandTotal", 0] } },
            lastOrderAt: { $max: "$createdAt" },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    const total = totalAgg[0]?.count || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const customerIds = rows.map((r) => r._id).filter(Boolean);
    const customers = customerIds.length
      ? await Customer.find({ _id: { $in: customerIds } })
          .select("fullName phoneNumber email")
          .lean()
      : [];
    const customerMap = new Map(customers.map((c) => [String(c._id), c]));

    const data = rows.map((r) => {
      const customer = customerMap.get(String(r._id)) || {};
      return {
        customerId: r._id || null,
        customerName: customer.fullName || null,
        customerPhone: customer.phoneNumber || null,
        customerEmail: customer.email || null,
        orders: r.orders,
        totalSpent: Math.round(r.totalSpent * 100) / 100,
        avgOrderValue:
          r.orders > 0 ? Math.round((r.totalSpent / r.orders) * 100) / 100 : 0,
        lastOrderAt: r.lastOrderAt || null,
      };
    });

    res.status(200).json({
      success: true,
      customers: data,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// ---------------------------------------------------------------------------
// GET /analytics/products?limit=
// Top products by revenue from purchasedItems (excludes custom-line items).
// ---------------------------------------------------------------------------
const getMerchantTopProductsController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { start, end } = resolveDateRange(req);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100
    );

    const rows = await Order.aggregate([
      {
        $match: {
          merchantId,
          status: { $ne: "Cancelled" },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $unwind: { path: "$purchasedItems", preserveNullAndEmptyArrays: true } },
      { $match: { purchasedItems: { $ne: null } } },
      {
        $group: {
          _id: {
            productId: { $ifNull: ["$purchasedItems.productId", null] },
            name: { $ifNull: ["$purchasedItems.productName", "Custom item"] },
          },
          quantity: { $sum: { $ifNull: ["$purchasedItems.quantity", 0] } },
          revenue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$purchasedItems.price", 0] },
                { $ifNull: ["$purchasedItems.quantity", 0] },
              ],
            },
          },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);

    const products = rows.map((r) => ({
      productId: r._id.productId,
      productName: r._id.name,
      quantity: r.quantity,
      revenue: Math.round(r.revenue * 100) / 100,
      orderCount: r.orderCount,
    }));

    res.status(200).json({
      success: true,
      products,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// ---------------------------------------------------------------------------
// GET /analytics/delivery
// Delivery performance: status breakdown, completion rate, avg delivery time
// (from completed orders with a recorded timeTaken) + top performing agents.
// ---------------------------------------------------------------------------
const getMerchantDeliveryPerformanceController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { start, end } = resolveDateRange(req);

    const [summary, topAgents] = await Promise.all([
      Order.aggregate([
        { $match: { merchantId, createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
            cancelledOrders: {
              $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] },
            },
            completedWithTime: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "Completed"] },
                      { $ne: ["$timeTaken", null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            completedTimeSum: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$status", "Completed"] },
                      { $ne: ["$timeTaken", null] },
                    ],
                  },
                  { $ifNull: ["$timeTaken", 0] },
                  0,
                ],
              },
            },
            totalDistance: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "Completed"] },
                  { $ifNull: ["$distance", 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Order.aggregate([
        {
          $match: {
            merchantId,
            status: "Completed",
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: "$agentId", deliveries: { $sum: 1 } } },
        { $sort: { deliveries: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const s = summary[0] || {};
    const completedOrders = s.completedOrders || 0;
    const totalOrders = s.totalOrders || 0;
    const completionRate =
      totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 1000) / 10 : 0;
    const avgDeliveryTimeMs =
      s.completedWithTime > 0
        ? Math.round((s.completedTimeSum || 0) / s.completedWithTime)
        : null;
    const avgDistance =
      completedOrders > 0
        ? Math.round(((s.totalDistance || 0) / completedOrders) * 100) / 100
        : 0;

    // Join agent names for the leaderboard
    const agentIds = topAgents.map((a) => a._id).filter(Boolean);
    const agents = agentIds.length
      ? await Agent.find({ _id: { $in: agentIds } })
          .select("fullName phoneNumber")
          .lean()
      : [];
    const agentMap = new Map(agents.map((a) => [String(a._id), a]));

    const leaderboard = topAgents.map((a) => ({
      agentId: a._id || null,
      agentName: agentMap.get(String(a._id))?.fullName || "Agent",
      agentPhone: agentMap.get(String(a._id))?.phoneNumber || null,
      deliveries: a.deliveries,
    }));

    res.status(200).json({
      success: true,
      delivery: {
        totalOrders,
        completedOrders,
        cancelledOrders: s.cancelledOrders || 0,
        completionRate,
        avgDeliveryTimeMs,
        avgDistance,
      },
      topAgents: leaderboard,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getMerchantAnalyticsSummaryController,
  getMerchantOrderTrendController,
  getMerchantTopCustomersController,
  getMerchantTopProductsController,
  getMerchantDeliveryPerformanceController,
};
