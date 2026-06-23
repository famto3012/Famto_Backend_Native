const WhatsappConversation = require("../../models/WhatsappConversation");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappWallet = require("../../models/WhatsappWallet");
const appError = require("../../utils/appError");
const { getWhatsappConfig } = require("../../utils/whatsappApi");
const axios = require("axios");

const getAnalytics = async (req, res, next) => {
  try {
    const { range = "7d" } = req.query;
    const days = parseInt(range) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { token, apiVersion, phoneNumberId } = getWhatsappConfig();

    const [
      totalConversations,
      openConversations,
      closedConversations,
      campaigns,
      wallet,
      conversationTrend,
      resolvedByDate,
      teamStats,
      messageTypeBreakdown,
      deliveryStatusBreakdown,
      hourlyActivity,
      topTemplates,
      avgResponseTime,
      metaPhoneResult,
    ] = await Promise.allSettled([
      WhatsappConversation.countDocuments({ createdAt: { $gte: startDate } }),
      WhatsappConversation.countDocuments({ status: "open" }),
      WhatsappConversation.countDocuments({
        status: "closed",
        updatedAt: { $gte: startDate },
      }),
      WhatsappCampaign.find({ createdAt: { $gte: startDate } }).lean(),
      WhatsappWallet.findOne().lean(),

      // Messages by date + direction
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
              direction: "$direction",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]),

      // Resolved conversations by date
      WhatsappConversation.aggregate([
        { $match: { status: "closed", updatedAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Team performance
      WhatsappMessage.aggregate([
        {
          $match: {
            direction: "outbound",
            timestamp: { $gte: startDate },
            senderName: { $ne: null },
          },
        },
        {
          $group: {
            _id: "$senderName",
            conversations: { $addToSet: "$conversationId" },
            messageCount: { $sum: 1 },
          },
        },
        {
          $project: {
            name: "$_id",
            conversations: { $size: "$conversations" },
            messageCount: 1,
          },
        },
        { $sort: { conversations: -1 } },
        { $limit: 10 },
      ]),

      // Message type breakdown (text, image, template, etc.)
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: { messageType: "$messageType", direction: "$direction" },
            count: { $sum: 1 },
          },
        },
      ]),

      // Delivery status breakdown for outbound
      WhatsappMessage.aggregate([
        {
          $match: {
            direction: "outbound",
            timestamp: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
      ]),

      // Hourly activity heatmap
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: {
              hour: { $hour: "$timestamp" },
              direction: "$direction",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.hour": 1 } },
      ]),

      // Top templates by usage
      WhatsappMessage.aggregate([
        {
          $match: {
            messageType: "template",
            direction: "outbound",
            timestamp: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$templateName",
            sent: { $sum: 1 },
            delivered: {
              $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] },
            },
            read: {
              $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ["$deliveryStatus", "failed"] }, 1, 0] },
            },
          },
        },
        { $sort: { sent: -1 } },
        { $limit: 10 },
      ]),

      // Average first response time (time from first inbound to first outbound per conversation)
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        { $sort: { conversationId: 1, timestamp: 1 } },
        {
          $group: {
            _id: "$conversationId",
            firstInbound: {
              $min: {
                $cond: [{ $eq: ["$direction", "inbound"] }, "$timestamp", null],
              },
            },
            firstOutbound: {
              $min: {
                $cond: [{ $eq: ["$direction", "outbound"] }, "$timestamp", null],
              },
            },
          },
        },
        {
          $match: {
            firstInbound: { $ne: null },
            firstOutbound: { $ne: null },
          },
        },
        {
          $project: {
            responseTimeMs: { $subtract: ["$firstOutbound", "$firstInbound"] },
          },
        },
        { $match: { responseTimeMs: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            avgResponseMs: { $avg: "$responseTimeMs" },
            medianValues: { $push: "$responseTimeMs" },
            count: { $sum: 1 },
          },
        },
      ]),

      // Meta: Phone health (live)
      axios
        .get(
          `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=quality_rating,messaging_limit_tier,status,throughput`,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
        )
        .then((r) => r.data),
    ]);

    const safe = (r) => (r.status === "fulfilled" ? r.value : null);

    // ── Build trend data ─────────────────────────────────────
    const trendMap = {};
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      const monthDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      trendMap[dateStr] = {
        date: dateStr,
        label: days <= 7 ? dayName : monthDay,
        inbound: 0,
        outbound: 0,
        resolved: 0,
      };
    }

    (safe(conversationTrend) || []).forEach((item) => {
      if (trendMap[item._id.date]) {
        trendMap[item._id.date][item._id.direction] = item.count;
      }
    });

    (safe(resolvedByDate) || []).forEach((item) => {
      if (trendMap[item._id]) {
        trendMap[item._id].resolved = item.count;
      }
    });

    // ── Campaign funnel ──────────────────────────────────────
    const campData = safe(campaigns) || [];
    let totalSent = 0;
    let totalDelivered = 0;
    let totalRead = 0;
    let totalFailed = 0;

    campData.forEach((c) => {
      totalSent += c.stats?.sent || 0;
      totalDelivered += c.stats?.delivered || 0;
      totalRead += c.stats?.read || 0;
      totalFailed += c.stats?.failed || 0;
    });

    // ── Message type breakdown ───────────────────────────────
    const typeData = safe(messageTypeBreakdown) || [];
    const messageTypes = {};
    let totalInboundMsgs = 0;
    let totalOutboundMsgs = 0;

    typeData.forEach((row) => {
      const type = row._id.messageType || "other";
      if (!messageTypes[type]) messageTypes[type] = { inbound: 0, outbound: 0, total: 0 };
      messageTypes[type][row._id.direction] = row.count;
      messageTypes[type].total += row.count;
      if (row._id.direction === "inbound") totalInboundMsgs += row.count;
      else totalOutboundMsgs += row.count;
    });

    const messageTypeArray = Object.entries(messageTypes)
      .map(([type, counts]) => ({ type, ...counts }))
      .sort((a, b) => b.total - a.total);

    // ── Delivery status ──────────────────────────────────────
    const deliveryData = safe(deliveryStatusBreakdown) || [];
    const delivery = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    deliveryData.forEach((row) => {
      if (delivery.hasOwnProperty(row._id)) delivery[row._id] = row.count;
    });

    const totalDeliveryMsgs = Object.values(delivery).reduce((a, b) => a + b, 0);

    // ── Hourly activity ──────────────────────────────────────
    const hourlyData = safe(hourlyActivity) || [];
    const hourly = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${i.toString().padStart(2, "0")}:00`,
      inbound: 0,
      outbound: 0,
      total: 0,
    }));

    hourlyData.forEach((row) => {
      const h = row._id.hour;
      if (hourly[h]) {
        hourly[h][row._id.direction] = row.count;
        hourly[h].total += row.count;
      }
    });

    // ── Top templates ────────────────────────────────────────
    const templateData = safe(topTemplates) || [];
    const templates = templateData.map((t) => ({
      name: t._id || "Unknown",
      sent: t.sent,
      delivered: t.delivered,
      read: t.read,
      failed: t.failed,
      deliveryRate: t.sent > 0 ? parseFloat(((t.delivered / t.sent) * 100).toFixed(1)) : 0,
      readRate: t.sent > 0 ? parseFloat(((t.read / t.sent) * 100).toFixed(1)) : 0,
    }));

    // ── Response time ────────────────────────────────────────
    const responseData = (safe(avgResponseTime) || [])[0];
    const avgResponseMins = responseData
      ? Math.round(responseData.avgResponseMs / 60000)
      : 0;

    // ── Meta phone health ────────────────────────────────────
    const metaPhone = safe(metaPhoneResult) || {};

    // ── Resolution rate ──────────────────────────────────────
    const totalConvs = safe(totalConversations) || 0;
    const closedConvs = safe(closedConversations) || 0;
    const resolutionRate =
      totalConvs > 0 ? Math.round((closedConvs / totalConvs) * 100) : 0;

    // ── Team perf ────────────────────────────────────────────
    const teamData = safe(teamStats) || [];

    res.status(200).json({
      success: true,
      data: {
        range: `${days}d`,

        summary: {
          conversations: totalConvs,
          openConversations: safe(openConversations) || 0,
          closedConversations: closedConvs,
          resolutionRate,
          avgFirstResponseMins: avgResponseMins,
          totalMessages: {
            sent: totalOutboundMsgs,
            received: totalInboundMsgs,
            total: totalOutboundMsgs + totalInboundMsgs,
          },
          walletBalance: (safe(wallet))?.balance || 0,
        },

        conversationTrend: Object.values(trendMap),

        messageTypes: messageTypeArray,

        delivery: {
          ...delivery,
          total: totalDeliveryMsgs,
          deliveryRate:
            totalDeliveryMsgs > 0
              ? parseFloat((((delivery.delivered + delivery.read) / totalDeliveryMsgs) * 100).toFixed(1))
              : 0,
          readRate:
            totalDeliveryMsgs > 0
              ? parseFloat(((delivery.read / totalDeliveryMsgs) * 100).toFixed(1))
              : 0,
        },

        hourlyActivity: hourly,

        topTemplates: templates,

        campaignFunnel: [
          { label: "Sent", value: totalSent },
          { label: "Delivered", value: totalDelivered },
          { label: "Read", value: totalRead },
          { label: "Failed", value: totalFailed },
        ],

        teamPerformance: teamData.map((agent) => ({
          name: agent.name,
          conversations: agent.conversations,
          messageCount: agent.messageCount,
        })),

        phone: {
          rating: metaPhone.quality_rating || "UNKNOWN",
          messagingLimit: metaPhone.messaging_limit_tier || "UNKNOWN",
          status: metaPhone.status || "UNKNOWN",
          throughput: metaPhone.throughput?.level || "STANDARD",
        },
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = { getAnalytics };
