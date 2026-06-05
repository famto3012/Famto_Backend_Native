const WhatsappBusinessProfile = require("../../models/WhatsappBusinessProfile");
const appError = require("../../utils/appError");
const {
  fetchBusinessProfile,
  updateMetaBusinessProfile,
  fetchConversationAnalytics,
  fetchAccountInfo,
  getWhatsappConfig,
} = require("../../utils/whatsappApi");
const axios = require("axios");

// ─── Meta Conversation Pricing (INR per conversation, as of 2024) ───
const PRICING_INR = {
  marketing: 0.882,
  utility: 0.15,
  authentication: 0.15,
  service: 0.0,
};

// ─── Wallet — Real Meta Billing Data ────────────────────

const getWallet = async (req, res, next) => {
  try {
    const now = new Date();

    // Current month range
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartTs = Math.floor(monthStart.getTime() / 1000);
    const nowTs = Math.floor(now.getTime() / 1000);

    // Fetch real data from Meta
    let analyticsData = {};
    let accountInfo = {};

    try {
      [analyticsData, accountInfo] = await Promise.all([
        fetchConversationAnalytics(monthStartTs, nowTs),
        fetchAccountInfo(),
      ]);
    } catch (metaErr) {
      console.error(
        "[WhatsApp Billing] Meta API error:",
        metaErr?.response?.data?.error?.message || metaErr.message
      );
      // Return empty data if Meta API fails — don't block the page
    }

    // Parse conversation analytics from Meta response
    const dataPoints = analyticsData?.data_points || [];
    const categoryTotals = {
      marketing: { conversations: 0, cost: 0 },
      utility: { conversations: 0, cost: 0 },
      authentication: { conversations: 0, cost: 0 },
      service: { conversations: 0, cost: 0 },
    };

    // Build daily spend for transaction history
    const dailySpend = {};

    for (const point of dataPoints) {
      const category = (point.conversation_category || "").toLowerCase();
      const count = point.conversation || 0;
      const cost = point.cost || 0;
      const date = point.start
        ? new Date(point.start * 1000).toISOString().split("T")[0]
        : null;

      if (categoryTotals[category]) {
        categoryTotals[category].conversations += count;
        categoryTotals[category].cost += cost;
      }

      if (date && count > 0) {
        if (!dailySpend[date]) {
          dailySpend[date] = { date, conversations: 0, cost: 0 };
        }
        dailySpend[date].conversations += count;
        dailySpend[date].cost += cost;
      }
    }

    const totalConversations = Object.values(categoryTotals).reduce(
      (sum, c) => sum + c.conversations,
      0
    );
    const totalCost = Object.values(categoryTotals).reduce(
      (sum, c) => sum + c.cost,
      0
    );

    // Convert cost from Meta (USD cents) to INR if needed
    const currency = accountInfo?.currency || "INR";

    // Build pricing breakdown for frontend
    const pricing = [
      {
        category: "Marketing",
        rate: PRICING_INR.marketing,
        conversations: categoryTotals.marketing.conversations,
        spend: categoryTotals.marketing.cost,
      },
      {
        category: "Utility",
        rate: PRICING_INR.utility,
        conversations: categoryTotals.utility.conversations,
        spend: categoryTotals.utility.cost,
      },
      {
        category: "Authentication",
        rate: PRICING_INR.authentication,
        conversations: categoryTotals.authentication.conversations,
        spend: categoryTotals.authentication.cost,
      },
      {
        category: "Service",
        rate: PRICING_INR.service,
        conversations: categoryTotals.service.conversations,
        spend: categoryTotals.service.cost,
      },
    ];

    // Build transaction list from daily spend
    const transactions = Object.values(dailySpend)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30)
      .map((day, i) => ({
        id: `meta-${day.date}`,
        type: "debit",
        amount: day.cost,
        status: "success",
        reference: `${day.conversations} conversations on ${day.date}`,
        createdAt: new Date(day.date).toISOString(),
      }));

    res.status(200).json({
      success: true,
      data: {
        balance: null,
        currency,
        totalSpent: totalCost,
        lowBalanceThreshold: null,
        monthlySpend: totalCost,
        totalConversations,
        billingPeriod: {
          start: monthStart.toISOString(),
          end: now.toISOString(),
        },
        account: {
          name: accountInfo?.name || "",
          reviewStatus: accountInfo?.account_review_status || "",
          timezone: accountInfo?.timezone_id || "",
        },
        pricing,
        transactions,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// ─── Business Profile ────────────────────────────────────

const getBusinessProfile = async (req, res, next) => {
  try {
    let profile = await WhatsappBusinessProfile.findOne();

    if (!profile) {
      const { phoneNumberId } = getWhatsappConfig();
      const metaProfile = await fetchBusinessProfile();

      profile = await WhatsappBusinessProfile.create({
        phoneNumberId,
        displayPhoneNumber: metaProfile.display_phone_number || "",
        verifiedName: metaProfile.verified_name || "",
        about: metaProfile.about || "",
        address: metaProfile.address || "",
        description: metaProfile.description || "",
        email: metaProfile.email || "",
        vertical: metaProfile.vertical || "",
        websites: metaProfile.websites || [],
        profilePictureUrl: metaProfile.profile_picture_url || "",
      });
    }

    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateBusinessProfile = async (req, res, next) => {
  try {
    const { about, address, description, email, vertical, websites } = req.body;

    const metaUpdate = {};
    if (about !== undefined) metaUpdate.about = about;
    if (address !== undefined) metaUpdate.address = address;
    if (description !== undefined) metaUpdate.description = description;
    if (email !== undefined) metaUpdate.email = email;
    if (vertical !== undefined) metaUpdate.vertical = vertical;
    if (websites !== undefined) metaUpdate.websites = websites;

    await updateMetaBusinessProfile(metaUpdate);

    const profile = await WhatsappBusinessProfile.findOneAndUpdate(
      {},
      { $set: metaUpdate },
      { new: true, upsert: true }
    );

    res.status(200).json({ success: true, data: profile });
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
  getBusinessProfile,
  updateBusinessProfile,
  verifyPhoneNumber,
};
