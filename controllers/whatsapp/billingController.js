const WhatsappWallet = require("../../models/WhatsappWallet");
const WhatsappBusinessProfile = require("../../models/WhatsappBusinessProfile");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappCampaign = require("../../models/WhatsappCampaign");
const WhatsappTemplate = require("../../models/WhatsappTemplate");
const appError = require("../../utils/appError");
const {
  updateMetaBusinessProfile,
  getWhatsappConfig,
} = require("../../utils/whatsappApi");
const axios = require("axios");

// INR rates per delivered message (Meta pricing India 2024-25)
const CONVERSATION_RATES = {
  marketing: 0.863,
  utility: 0.119,
  authentication: 0.04,
  service: 0.0,
};

// ─── Helpers ────────────────────────────────────────────

const getOrCreateWallet = async () => {
  let wallet = await WhatsappWallet.findOne();
  if (!wallet) {
    wallet = await WhatsappWallet.create({ balance: 0 });
  }
  return wallet;
};

const metaGet = async (url, token, timeout = 8000) => {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout,
  });
  return res.data;
};

// ─── Wallet (comprehensive billing dashboard) ───────────

const getWallet = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const { token, apiVersion, phoneNumberId, businessAccountId } = getWhatsappConfig();
    const headers = { Authorization: `Bearer ${token}` };

    // ── 1. Parallel: DB aggregations + Meta API calls ────────
    const [
      msgStats,
      campaignStats,
      lastMonthMsgStats,
      dailyBreakdown,
      deliveryStats,
      templateUsage,
      metaPhoneResult,
      metaWabaResult,
      metaTemplatesResult,
    ] = await Promise.allSettled([
      // This month by direction + type + delivery status
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startOfMonth, $lte: now } } },
        {
          $group: {
            _id: { direction: "$direction", messageType: "$messageType", deliveryStatus: "$deliveryStatus" },
            count: { $sum: 1 },
          },
        },
      ]),

      // Campaign stats this month
      WhatsappCampaign.aggregate([
        { $match: { createdAt: { $gte: startOfMonth, $lte: now }, status: { $in: ["sent", "completed", "partial"] } } },
        {
          $group: {
            _id: null,
            totalCampaigns: { $sum: 1 },
            totalSent: { $sum: "$stats.sent" },
            totalDelivered: { $sum: "$stats.delivered" },
            totalRead: { $sum: "$stats.read" },
            totalFailed: { $sum: "$stats.failed" },
          },
        },
      ]),

      // Last month for comparison
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
        {
          $group: {
            _id: { direction: "$direction", messageType: "$messageType", deliveryStatus: "$deliveryStatus" },
            count: { $sum: 1 },
          },
        },
      ]),

      // Daily breakdown (day-by-day spend chart)
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startOfMonth, $lte: now } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
              direction: "$direction",
              messageType: "$messageType",
              deliveryStatus: "$deliveryStatus",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]),

      // Delivery status breakdown this month
      WhatsappMessage.aggregate([
        {
          $match: {
            direction: "outbound",
            timestamp: { $gte: startOfMonth, $lte: now },
          },
        },
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
      ]),

      // Top templates by usage this month
      WhatsappMessage.aggregate([
        {
          $match: {
            messageType: "template",
            direction: "outbound",
            timestamp: { $gte: startOfMonth, $lte: now },
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

      // Meta: Phone number details (quality, limits, status)
      metaGet(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=quality_rating,messaging_limit_tier,display_phone_number,verified_name,name_status,code_verification_status,platform_type,throughput,is_official_business_account,status,last_onboarded_time`,
        token
      ),

      // Meta: WABA account info
      metaGet(
        `https://graph.facebook.com/${apiVersion}/${businessAccountId}?fields=name,timezone_id,account_review_status,on_behalf_of_business_info,message_template_namespace`,
        token
      ),

      // Meta: Template status counts
      metaGet(
        `https://graph.facebook.com/${apiVersion}/${businessAccountId}/message_templates?fields=name,status,category&limit=500`,
        token
      ),
    ]);

    // ── 2. Parse message stats ───────────────────────────────
    const safe = (r) => (r.status === "fulfilled" ? r.value : null);

    const msgData = safe(msgStats) || [];
    const DELIVERED_STATUSES = ["delivered", "read"];
    let marketingDelivered = 0;
    let utilityDelivered = 0;
    let serviceDelivered = 0;
    let outboundTemplateMessages = 0;
    let outboundRegularMessages = 0;
    let totalOutbound = 0;
    let totalInbound = 0;

    msgData.forEach((row) => {
      const { direction, messageType, deliveryStatus } = row._id;
      const isDelivered = DELIVERED_STATUSES.includes(deliveryStatus);

      if (direction === "outbound") {
        totalOutbound += row.count;
        if (messageType === "template") {
          outboundTemplateMessages += row.count;
          if (isDelivered) marketingDelivered += row.count;
        } else {
          outboundRegularMessages += row.count;
          if (isDelivered) utilityDelivered += row.count;
        }
      } else {
        totalInbound += row.count;
        if (isDelivered) serviceDelivered += row.count;
      }
    });

    // ── 3. Spend (based on delivered messages per category) ──
    const freeServiceMessages = Math.min(serviceDelivered, 1000);
    const paidServiceMessages = Math.max(0, serviceDelivered - 1000);

    const marketingSpend = marketingDelivered * CONVERSATION_RATES.marketing;
    const utilitySpend = utilityDelivered * CONVERSATION_RATES.utility;
    const serviceSpend = paidServiceMessages * 0.04;
    const totalSpend = marketingSpend + utilitySpend + serviceSpend;

    // Last month
    const lastMonthData = safe(lastMonthMsgStats) || [];
    let lastOutbound = 0;
    let lastInbound = 0;
    let lastMarketingDelivered = 0;
    let lastUtilityDelivered = 0;

    lastMonthData.forEach((row) => {
      const { direction, messageType, deliveryStatus } = row._id;
      const isDelivered = DELIVERED_STATUSES.includes(deliveryStatus);

      if (direction === "outbound") {
        lastOutbound += row.count;
        if (messageType === "template" && isDelivered) lastMarketingDelivered += row.count;
        else if (isDelivered) lastUtilityDelivered += row.count;
      } else {
        lastInbound += row.count;
      }
    });

    const lastMonthSpend =
      lastMarketingDelivered * CONVERSATION_RATES.marketing +
      lastUtilityDelivered * CONVERSATION_RATES.utility;

    // ── 4. Daily usage chart ─────────────────────────────────
    const dailyData = safe(dailyBreakdown) || [];
    const dailyMap = {};
    dailyData.forEach((row) => {
      const { date, direction, messageType, deliveryStatus } = row._id;
      const isDelivered = DELIVERED_STATUSES.includes(deliveryStatus);

      if (!dailyMap[date]) {
        dailyMap[date] = { date, sent: 0, received: 0, marketingDelivered: 0, utilityDelivered: 0, spend: 0 };
      }
      if (direction === "outbound") {
        dailyMap[date].sent += row.count;
        if (isDelivered) {
          if (messageType === "template") {
            dailyMap[date].marketingDelivered += row.count;
          } else {
            dailyMap[date].utilityDelivered += row.count;
          }
        }
      } else {
        dailyMap[date].received += row.count;
      }
    });

    const dailyUsage = Object.values(dailyMap).map((day) => {
      day.spend = parseFloat(
        (day.marketingDelivered * CONVERSATION_RATES.marketing +
          day.utilityDelivered * CONVERSATION_RATES.utility).toFixed(2)
      );
      return day;
    });

    // ── 5. Delivery status funnel ────────────────────────────
    const deliveryData = safe(deliveryStats) || [];
    const delivery = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    deliveryData.forEach((row) => {
      if (delivery.hasOwnProperty(row._id)) delivery[row._id] = row.count;
    });

    // ── 6. Template usage ────────────────────────────────────
    const templateData = safe(templateUsage) || [];
    const topTemplates = templateData.map((t) => ({
      name: t._id || "Unknown",
      sent: t.sent,
      delivered: t.delivered,
      read: t.read,
      failed: t.failed,
      deliveryRate: t.sent > 0 ? parseFloat(((t.delivered / t.sent) * 100).toFixed(1)) : 0,
      readRate: t.sent > 0 ? parseFloat(((t.read / t.sent) * 100).toFixed(1)) : 0,
    }));

    // ── 7. Meta phone health ─────────────────────────────────
    const phoneRaw = safe(metaPhoneResult) || {};
    const phone = {
      displayNumber: phoneRaw.display_phone_number || "",
      verifiedName: phoneRaw.verified_name || "",
      rating: phoneRaw.quality_rating || "UNKNOWN",
      messagingLimit: phoneRaw.messaging_limit_tier || "UNKNOWN",
      nameStatus: phoneRaw.name_status || "UNKNOWN",
      codeVerification: phoneRaw.code_verification_status || "UNKNOWN",
      platform: phoneRaw.platform_type || "CLOUD_API",
      throughput: phoneRaw.throughput?.level || "STANDARD",
      isOfficialAccount: phoneRaw.is_official_business_account || false,
      phoneStatus: phoneRaw.status || "UNKNOWN",
      lastOnboarded: phoneRaw.last_onboarded_time || null,
    };

    // ── 8. Meta WABA info ────────────────────────────────────
    const wabaRaw = safe(metaWabaResult) || {};
    const account = {
      name: wabaRaw.name || "",
      timezone: wabaRaw.timezone_id || "",
      reviewStatus: wabaRaw.account_review_status || "UNKNOWN",
      businessName: wabaRaw.on_behalf_of_business_info?.name || "",
      businessId: wabaRaw.on_behalf_of_business_info?.id || "",
      templateNamespace: wabaRaw.message_template_namespace || "",
    };

    // ── 9. Template status summary from Meta ─────────────────
    const metaTemplatesRaw = safe(metaTemplatesResult);
    const templateStatusCounts = { APPROVED: 0, PENDING: 0, REJECTED: 0, PAUSED: 0, DISABLED: 0 };
    const templatesByCategory = {};

    if (metaTemplatesRaw?.data) {
      metaTemplatesRaw.data.forEach((t) => {
        const status = t.status || "UNKNOWN";
        if (templateStatusCounts.hasOwnProperty(status)) {
          templateStatusCounts[status]++;
        }
        const cat = t.category || "UNKNOWN";
        if (!templatesByCategory[cat]) templatesByCategory[cat] = 0;
        templatesByCategory[cat]++;
      });
    }

    // ── 10. Campaign summary ─────────────────────────────────
    const camp = (safe(campaignStats) || [])[0] || {};

    // ── 11. Build response ───────────────────────────────────
    res.status(200).json({
      success: true,
      data: {
        currency: "INR",

        thisMonth: {
          spend: parseFloat(totalSpend.toFixed(2)),
          conversations: marketingDelivered + utilityDelivered + serviceDelivered,
          messages: { sent: totalOutbound, received: totalInbound, total: totalOutbound + totalInbound },
          periodLabel: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
          dailyUsage,
        },

        lastMonth: {
          spend: parseFloat(lastMonthSpend.toFixed(2)),
          messages: { sent: lastOutbound, received: lastInbound },
          periodLabel: startOfLastMonth.toLocaleString("en-IN", { month: "long", year: "numeric" }),
        },

        pricing: [
          {
            category: "Marketing",
            rate: CONVERSATION_RATES.marketing,
            conversations: marketingDelivered,
            messages: outboundTemplateMessages,
            spend: parseFloat(marketingSpend.toFixed(2)),
            description: "Template messages delivered",
            color: "violet",
          },
          {
            category: "Utility",
            rate: CONVERSATION_RATES.utility,
            conversations: utilityDelivered,
            messages: outboundRegularMessages,
            spend: parseFloat(utilitySpend.toFixed(2)),
            description: "Non-template outbound delivered",
            color: "sky",
          },
          {
            category: "Service",
            rate: 0,
            conversations: freeServiceMessages,
            messages: totalInbound,
            spend: 0,
            description: "Free (first 1,000/month) — customer-initiated",
            color: "emerald",
          },
          ...(paidServiceMessages > 0
            ? [
                {
                  category: "Service (paid)",
                  rate: 0.04,
                  conversations: paidServiceMessages,
                  messages: 0,
                  spend: parseFloat(serviceSpend.toFixed(2)),
                  description: "Customer-initiated (over 1,000 free)",
                  color: "amber",
                },
              ]
            : []),
        ],

        delivery,

        topTemplates,

        campaigns: {
          total: camp.totalCampaigns || 0,
          sent: camp.totalSent || 0,
          delivered: camp.totalDelivered || 0,
          read: camp.totalRead || 0,
          failed: camp.totalFailed || 0,
          deliveryRate: camp.totalSent ? parseFloat(((camp.totalDelivered / camp.totalSent) * 100).toFixed(1)) : 0,
          readRate: camp.totalSent ? parseFloat(((camp.totalRead / camp.totalSent) * 100).toFixed(1)) : 0,
        },

        phone,

        account,

        templates: {
          statusCounts: templateStatusCounts,
          byCategory: templatesByCategory,
          total: metaTemplatesRaw?.data?.length || 0,
        },

        billingNote:
          "Meta bills your registered payment method directly on the 1st of each month. Spend shown here is estimated from messages tracked in this dashboard.",
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const rechargeWallet = async (req, res, next) => {
  try {
    const { amount, paymentMethod, transactionId, notes } = req.body;

    if (!amount || amount <= 0) {
      return next(appError("Valid amount is required", 400));
    }

    const wallet = await getOrCreateWallet();

    wallet.rechargeHistory.push({
      amount,
      paymentMethod: paymentMethod || "manual",
      transactionId: transactionId || `TXN_${Date.now()}`,
      status: "completed",
      notes,
    });

    wallet.balance += amount;
    wallet.lastRechargedAt = new Date();
    await wallet.save();

    res.status(200).json({
      success: true,
      message: "Wallet recharged successfully",
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// ─── Business Profile ────────────────────────────────────

const getBusinessProfile = async (req, res, next) => {
  try {
    const { token, apiVersion, phoneNumberId, businessAccountId } = getWhatsappConfig();
    const headers = { Authorization: `Bearer ${token}` };

    let phoneData = {};
    let businessProfileData = {};

    const [phoneRes, profileRes] = await Promise.allSettled([
      axios.get(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,name_status`,
        { headers, timeout: 8000 }
      ),
      axios.get(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
        { headers, timeout: 8000 }
      ),
    ]);

    if (phoneRes.status === "fulfilled") {
      phoneData = phoneRes.value.data || {};
    } else {
      console.error("[BusinessProfile] Meta phone fetch failed:", phoneRes.reason?.response?.data?.error?.message || phoneRes.reason?.message);
    }

    if (profileRes.status === "fulfilled") {
      const profileArray = profileRes.value.data?.data;
      if (Array.isArray(profileArray) && profileArray.length > 0) {
        businessProfileData = profileArray[0];
      }
    } else {
      console.error("[BusinessProfile] Meta business profile fetch failed:", profileRes.reason?.response?.data?.error?.message || profileRes.reason?.message);
    }

    const updateData = { phoneNumberId };
    if (phoneData.verified_name) updateData.verifiedName = phoneData.verified_name;
    if (phoneData.display_phone_number) updateData.displayPhoneNumber = phoneData.display_phone_number;
    if (phoneData.quality_rating) updateData.qualityRating = phoneData.quality_rating;
    if (phoneData.messaging_limit_tier) updateData.messagingLimitTier = phoneData.messaging_limit_tier;

    if (businessProfileData.description) updateData.description = businessProfileData.description;
    if (businessProfileData.about) updateData.about = businessProfileData.about;
    if (businessProfileData.address) updateData.address = businessProfileData.address;
    if (businessProfileData.email) updateData.email = businessProfileData.email;
    if (businessProfileData.vertical) updateData.vertical = businessProfileData.vertical;
    if (businessProfileData.websites) updateData.websites = businessProfileData.websites;
    if (businessProfileData.profile_picture_url) updateData.profilePictureUrl = businessProfileData.profile_picture_url;

    const profile = await WhatsappBusinessProfile.findOneAndUpdate(
      {},
      { $set: updateData },
      { new: true, upsert: true }
    );

    const appUrl = process.env.APP_URL || process.env.BACKEND_URL || "https://api.famto.in";
    const webhookUrl = `${appUrl}/api/v1/whatsapp/webhook`;

    const nameStatus = phoneData.name_status;
    const certificateStatus =
      nameStatus === "APPROVED" || nameStatus === "APPROVED_UPDATE_PENDING"
        ? "VERIFIED"
        : nameStatus === "PENDING_REVIEW"
          ? "PENDING REVIEW"
          : nameStatus === "REJECTED"
            ? "REJECTED"
            : "VERIFIED";

    res.status(200).json({
      success: true,
      data: {
        displayName: profile.verifiedName || "",
        verifiedName: profile.verifiedName || "",
        description: profile.description || "",
        about: profile.about || "",
        website: profile.websites?.[0] || "",
        vertical: profile.vertical || "",
        address: profile.address || "",
        email: profile.email || "",
        profilePictureUrl: profile.profilePictureUrl || "",

        phoneNumber: profile.displayPhoneNumber || phoneNumberId || "",
        businessAccountId: businessAccountId || "",
        webhookUrl,
        status: "CONNECTED",

        health: {
          qualityRating: profile.qualityRating || "UNKNOWN",
          messagingLimit: profile.messagingLimitTier || "UNKNOWN",
          certificateStatus,
        },
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateBusinessProfile = async (req, res, next) => {
  try {
    const { about, address, description, email, vertical, websites, website } = req.body;

    const metaUpdate = {};
    if (about !== undefined) metaUpdate.about = about;
    if (address !== undefined) metaUpdate.address = address;
    if (description !== undefined) metaUpdate.description = description;
    if (email !== undefined) metaUpdate.email = email;
    if (vertical !== undefined) metaUpdate.vertical = vertical;
    if (websites !== undefined) metaUpdate.websites = websites;
    if (website !== undefined) metaUpdate.websites = website ? [website] : [];

    await updateMetaBusinessProfile(metaUpdate);

    const profile = await WhatsappBusinessProfile.findOneAndUpdate(
      {},
      { $set: metaUpdate },
      { new: true, upsert: true }
    );

    const { businessAccountId, phoneNumberId } = getWhatsappConfig();
    const appUrl = process.env.APP_URL || process.env.BACKEND_URL || "https://api.famto.in";

    res.status(200).json({
      success: true,
      data: {
        displayName: profile.verifiedName || "",
        verifiedName: profile.verifiedName || "",
        description: profile.description || "",
        about: profile.about || "",
        website: profile.websites?.[0] || "",
        vertical: profile.vertical || "",
        address: profile.address || "",
        email: profile.email || "",
        profilePictureUrl: profile.profilePictureUrl || "",
        phoneNumber: profile.displayPhoneNumber || phoneNumberId || "",
        businessAccountId: businessAccountId || "",
        webhookUrl: `${appUrl}/api/v1/whatsapp/webhook`,
        status: "CONNECTED",
        health: {
          qualityRating: profile.qualityRating || "UNKNOWN",
          messagingLimit: profile.messagingLimitTier || "UNKNOWN",
          certificateStatus: "VERIFIED",
        },
      },
    });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    next(appError(metaError, err.response?.status || 500));
  }
};

// ─── Phone Number Verification ───────────────────────────

const verifyPhoneNumber = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code) {
      return next(appError("Verification code is required", 400));
    }

    const { token, apiVersion, phoneNumberId } = getWhatsappConfig();

    const response = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/verify_code`,
      { code },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "Phone number verified successfully",
      data: response.data,
    });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    next(appError(metaError, err.response?.status || 500));
  }
};

module.exports = {
  getWallet,
  rechargeWallet,
  getBusinessProfile,
  updateBusinessProfile,
  verifyPhoneNumber,
};
