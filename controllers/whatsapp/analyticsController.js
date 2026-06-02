const WhatsappConversation = require("../../models/WhatsappConversation");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappWallet = require("../../models/WhatsappWallet");
const Admin = require("../../models/Admin");
const Manager = require("../../models/Manager");
const appError = require("../../utils/appError");

const getAnalytics = async (req, res, next) => {
  try {
    const { range = "7d" } = req.query;

    const days = parseInt(range) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [
      totalConversations,
      openConversations,
      closedConversations,
      inboundMessages,
      outboundMessages,
      campaigns,
      wallet,
      conversationTrend,
      teamStats,
    ] = await Promise.all([
      WhatsappConversation.countDocuments({ createdAt: { $gte: startDate } }),
      WhatsappConversation.countDocuments({ status: "open" }),
      WhatsappConversation.countDocuments({
        status: "closed",
        updatedAt: { $gte: startDate },
      }),
      WhatsappMessage.countDocuments({
        direction: "inbound",
        timestamp: { $gte: startDate },
      }),
      WhatsappMessage.countDocuments({
        direction: "outbound",
        timestamp: { $gte: startDate },
      }),
      WhatsappCampaign.find({ createdAt: { $gte: startDate } }).lean(),
      WhatsappWallet.findOne().lean(),
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: {
              day: { $dayOfWeek: "$timestamp" },
              direction: "$direction",
            },
            count: { $sum: 1 },
          },
        },
      ]),
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
    ]);

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const trendMap = {};
    dayLabels.forEach((label) => {
      trendMap[label] = { label, inbound: 0, outbound: 0, resolved: 0 };
    });

    conversationTrend.forEach((item) => {
      const label = dayLabels[item._id.day - 1];
      if (trendMap[label]) {
        trendMap[label][item._id.direction] = item.count;
      }
    });

    const resolvedByDay = await WhatsappConversation.aggregate([
      {
        $match: {
          status: "closed",
          updatedAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $dayOfWeek: "$updatedAt" },
          count: { $sum: 1 },
        },
      },
    ]);

    resolvedByDay.forEach((item) => {
      const label = dayLabels[item._id - 1];
      if (trendMap[label]) {
        trendMap[label].resolved = item.count;
      }
    });

    let totalSent = 0;
    let totalDelivered = 0;
    let totalRead = 0;
    let totalReplied = 0;

    campaigns.forEach((c) => {
      totalSent += c.stats?.sent || 0;
      totalDelivered += c.stats?.delivered || 0;
      totalRead += c.stats?.read || 0;
    });

    const resolutionRate =
      totalConversations > 0
        ? Math.round((closedConversations / totalConversations) * 100)
        : 0;

    const teamPerformance = teamStats.map((agent) => ({
      name: agent.name,
      conversations: agent.conversations,
      csat: 0,
      avgResponse: 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        summary: {
          conversations: totalConversations,
          openConversations,
          avgFirstResponseMins: 0,
          resolutionRate,
          campaignRevenue: 0,
          walletBalance: wallet?.balance || 0,
        },
        conversationTrend: dayLabels.map((label) => trendMap[label]),
        campaignFunnel: [
          { label: "Sent", value: totalSent },
          { label: "Delivered", value: totalDelivered },
          { label: "Read", value: totalRead },
          { label: "Replies", value: totalReplied },
        ],
        teamPerformance,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = { getAnalytics };
