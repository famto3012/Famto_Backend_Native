const WhatsappWallet = require("../../models/WhatsappWallet");
const WhatsappBusinessProfile = require("../../models/WhatsappBusinessProfile");
const WhatsappMessage = require("../../models/WhatsappMessage");
const WhatsappCampaign = require("../../models/WhatsappCampaign");
const appError = require("../../utils/appError");
const {
  updateMetaBusinessProfile,
  getWhatsappConfig,
} = require("../../utils/whatsappApi");
const axios = require("axios");

// INR rates per conversation (Meta pricing as of 2024)
const CONVERSATION_RATES = {
  marketing: 0.88,
  utility: 0.18,
  authentication: 0.13,
  service: 0.00,
};

// ─── Wallet ──────────────────────────────────────────────

const getOrCreateWallet = async () => {
  let wallet = await WhatsappWallet.findOne();
  if (!wallet) {
    wallet = await WhatsappWallet.create({ balance: 0 });
  }
  return wallet;
};

const getWallet = async (req, res, next) => {
  try {
    // ── Date ranges ─────────────────────────────────────────
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // ── 1. Real message counts from DB ───────────────────────
    const [msgStats, campaignStats, lastMonthMsgStats] = await Promise.all([
      // This month breakdown by direction + type
      WhatsappMessage.aggregate([
        { $match: { timestamp: { $gte: startOfMonth, $lte: now } } },
        {
          $group: {
            _id: { direction: "$direction", messageType: "$messageType" },
            count: { $sum: 1 },
            uniqueContacts: { $addToSet: "$waId" },
          },
        },
      ]),

      // Campaign stats this month
      WhatsappCampaign.aggregate([
        { $match: { createdAt: { $gte: startOfMonth, $lte: now }, status: { $in: ["sent", "completed"] } } },
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
            _id: "$direction",
            count: { $sum: 1 },
            uniqueContacts: { $addToSet: "$waId" },
          },
        },
      ]),
    ]);

    // ── 2. Parse message stats ───────────────────────────────
    let outboundTemplateContacts = new Set();
    let outboundRegularContacts = new Set();
    let inboundContacts = new Set();
    let outboundTemplateMessages = 0;
    let outboundRegularMessages = 0;
    let inboundMessages = 0;
    let totalOutbound = 0;
    let totalInbound = 0;

    msgStats.forEach((row) => {
      const { direction, messageType } = row._id;
      if (direction === "outbound") {
        totalOutbound += row.count;
        if (messageType === "template") {
          outboundTemplateMessages += row.count;
          row.uniqueContacts.forEach((c) => outboundTemplateContacts.add(c));
        } else {
          outboundRegularMessages += row.count;
          row.uniqueContacts.forEach((c) => outboundRegularContacts.add(c));
        }
      } else {
        totalInbound += row.count;
        inboundMessages += row.count;
        row.uniqueContacts.forEach((c) => inboundContacts.add(c));
      }
    });

    // ── 3. Estimate conversations (unique contact per category) ─
    // Marketing: template messages sent to customers (1 conv per unique contact per 24h)
    const marketingConversations = outboundTemplateContacts.size;
    // Utility: regular outbound replies (non-template)
    const utilityConversations = outboundRegularContacts.size;
    // Service: customers who messaged us (free tier: first 1000/month)
    const serviceConversations = inboundContacts.size;
    const freeServiceConversations = Math.min(serviceConversations, 1000);
    const paidServiceConversations = Math.max(0, serviceConversations - 1000);

    // ── 4. Calculate estimated spend ─────────────────────────
    const marketingSpend = marketingConversations * CONVERSATION_RATES.marketing;
    const utilitySpend = utilityConversations * CONVERSATION_RATES.utility;
    const serviceSpend = paidServiceConversations * 0.04; // paid service rate
    const totalSpend = marketingSpend + utilitySpend + serviceSpend;

    // Last month comparison
    const lastMonthOutbound = lastMonthMsgStats.find((r) => r._id === "outbound");
    const lastMonthInbound = lastMonthMsgStats.find((r) => r._id === "inbound");
    const lastMonthSpendEstimate =
      (lastMonthOutbound?.uniqueContacts?.length || 0) * CONVERSATION_RATES.marketing;

    // ── 5. Pull phone quality from Meta (live) ───────────────
    let phoneQuality = { rating: "UNKNOWN", messagingLimit: "UNKNOWN" };
    try {
      const { token, apiVersion, phoneNumberId } = getWhatsappConfig();
      const metaPhone = await axios.get(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=quality_rating,messaging_limit_tier,display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }
      );
      phoneQuality = {
        rating: metaPhone.data.quality_rating || "UNKNOWN",
        messagingLimit: metaPhone.data.messaging_limit_tier || "UNKNOWN",
        displayNumber: metaPhone.data.display_phone_number,
        verifiedName: metaPhone.data.verified_name,
      };
    } catch (_) {
      // Non-critical — don't fail the whole response
    }

    // ── 6. Campaign summary ──────────────────────────────────
    const camp = campaignStats[0] || {};

    // ── 7. Build response ────────────────────────────────────
    res.status(200).json({
      success: true,
      data: {
        // Spend summary
        currency: "INR",
        thisMonth: {
          spend: parseFloat(totalSpend.toFixed(2)),
          conversations: marketingConversations + utilityConversations + serviceConversations,
          messages: { sent: totalOutbound, received: totalInbound },
          periodLabel: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
        },
        lastMonth: {
          spend: parseFloat(lastMonthSpendEstimate.toFixed(2)),
          messages: {
            sent: lastMonthOutbound?.count || 0,
            received: lastMonthInbound?.count || 0,
          },
          periodLabel: startOfLastMonth.toLocaleString("en-IN", { month: "long", year: "numeric" }),
        },

        // Conversation breakdown — now includes message counts per category
        pricing: [
          {
            category: "Marketing",
            rate: CONVERSATION_RATES.marketing,
            conversations: marketingConversations,
            messages: outboundTemplateMessages,
            spend: parseFloat(marketingSpend.toFixed(2)),
            description: "Template messages sent by you",
            color: "violet",
          },
          {
            category: "Utility",
            rate: CONVERSATION_RATES.utility,
            conversations: utilityConversations,
            messages: outboundRegularMessages,
            spend: parseFloat(utilitySpend.toFixed(2)),
            description: "Replies & non-template outbound",
            color: "sky",
          },
          {
            category: "Service",
            rate: 0,
            conversations: freeServiceConversations,
            messages: inboundMessages,
            spend: 0,
            description: `Free (first 1,000/month) — customer-initiated`,
            color: "emerald",
          },
          ...(paidServiceConversations > 0
            ? [{
                category: "Service (paid)",
                rate: 0.04,
                conversations: paidServiceConversations,
                messages: 0,
                spend: parseFloat(serviceSpend.toFixed(2)),
                description: "Customer-initiated (over 1,000 free)",
                color: "amber",
              }]
            : []),
        ],

        // Campaign performance
        campaigns: {
          total: camp.totalCampaigns || 0,
          sent: camp.totalSent || 0,
          delivered: camp.totalDelivered || 0,
          read: camp.totalRead || 0,
          failed: camp.totalFailed || 0,
          deliveryRate: camp.totalSent
            ? parseFloat(((camp.totalDelivered / camp.totalSent) * 100).toFixed(1))
            : 0,
          readRate: camp.totalSent
            ? parseFloat(((camp.totalRead / camp.totalSent) * 100).toFixed(1))
            : 0,
        },

        // Phone health (live from Meta)
        phone: phoneQuality,

        // Meta billing note
        billingNote: "Meta bills your registered payment method directly on the 1st of each month. Spend shown here is estimated from messages tracked in this dashboard.",
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

    // 1. Fetch fresh phone data from Meta.
    //    The /whatsapp_business_profile endpoint requires extra Meta app permissions
    //    that a standard Cloud API token doesn't have, so we only call the phone
    //    number endpoint (which always works) and keep editable fields in our DB.
    let phoneData = {};
    try {
      const phoneRes = await axios.get(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,messaging_limit_tier,name_status`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
      );
      phoneData = phoneRes.data || {};
    } catch (metaErr) {
      console.error("[BusinessProfile] Meta phone fetch failed:", metaErr.response?.data?.error?.message || metaErr.message);
      // Non-fatal — continue with DB data
    }

    // 2. Upsert the fields we got from Meta into DB
    const updateData = { phoneNumberId };
    if (phoneData.verified_name) updateData.verifiedName = phoneData.verified_name;
    if (phoneData.display_phone_number) updateData.displayPhoneNumber = phoneData.display_phone_number;
    if (phoneData.quality_rating) updateData.qualityRating = phoneData.quality_rating;
    if (phoneData.messaging_limit_tier) updateData.messagingLimitTier = phoneData.messaging_limit_tier;

    const profile = await WhatsappBusinessProfile.findOneAndUpdate(
      {},
      { $set: updateData },
      { new: true, upsert: true }
    );

    // 3. Construct webhook URL
    const appUrl = process.env.APP_URL || process.env.BACKEND_URL || "https://api.famto.in";
    const webhookUrl = `${appUrl}/api/v1/whatsapp/webhook`;

    // 4. Return frontend-friendly shape.
    //    Frontend reads: displayName, verifiedName, description, website (string),
    //    vertical, address, phoneNumber, businessAccountId, webhookUrl, status,
    //    health.qualityRating, health.messagingLimit, health.certificateStatus
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
        // Left-panel form fields (editable — stored in our DB)
        displayName: profile.verifiedName || "",
        verifiedName: profile.verifiedName || "",
        description: profile.description || "",
        about: profile.about || "",
        website: profile.websites?.[0] || "",
        vertical: profile.vertical || "",
        address: profile.address || "",
        email: profile.email || "",
        profilePictureUrl: profile.profilePictureUrl || "",

        // Right sidebar — Cloud API connection
        phoneNumber: profile.displayPhoneNumber || phoneNumberId || "",
        businessAccountId: businessAccountId || "",
        webhookUrl,
        status: "CONNECTED",

        // Right sidebar — Health (live from Meta phone endpoint)
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
    // Frontend sends `website` (single string); Meta + DB store as `websites` (array)
    const { about, address, description, email, vertical, websites, website } = req.body;

    const metaUpdate = {};
    if (about !== undefined) metaUpdate.about = about;
    if (address !== undefined) metaUpdate.address = address;
    if (description !== undefined) metaUpdate.description = description;
    if (email !== undefined) metaUpdate.email = email;
    if (vertical !== undefined) metaUpdate.vertical = vertical;
    if (websites !== undefined) metaUpdate.websites = websites;
    // Also accept a single website string from the frontend form
    if (website !== undefined) metaUpdate.websites = website ? [website] : [];

    await updateMetaBusinessProfile(metaUpdate);

    const profile = await WhatsappBusinessProfile.findOneAndUpdate(
      {},
      { $set: metaUpdate },
      { new: true, upsert: true }
    );

    // Return same frontend-friendly shape as getBusinessProfile
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
    const metaError =
      err.response?.data?.error?.message || err.message;
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
    const metaError =
      err.response?.data?.error?.message || err.message;
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
