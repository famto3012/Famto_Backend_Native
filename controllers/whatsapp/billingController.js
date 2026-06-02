const WhatsappWallet = require("../../models/WhatsappWallet");
const WhatsappBusinessProfile = require("../../models/WhatsappBusinessProfile");
const appError = require("../../utils/appError");
const {
  fetchBusinessProfile,
  updateMetaBusinessProfile,
  getWhatsappConfig,
} = require("../../utils/whatsappApi");
const axios = require("axios");

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
    const wallet = await getOrCreateWallet();

    const transactions = wallet.rechargeHistory
      .slice(-20)
      .reverse()
      .map((t) => ({
        id: t._id,
        type: "credit",
        amount: t.amount,
        status: t.status || "success",
        reference: t.notes || t.transactionId || "Recharge",
        createdAt: t.createdAt || t._id.getTimestamp(),
      }));

    res.status(200).json({
      success: true,
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
        totalSpent: wallet.totalSpent || 0,
        lowBalanceThreshold: 5000,
        monthlySpend: wallet.totalSpent || 0,
        lastRechargedAt: wallet.lastRechargedAt,
        pricing: [
          { category: "Marketing", rate: 0.88, conversations: 0, spend: 0 },
          { category: "Utility", rate: 0.18, conversations: 0, spend: 0 },
          { category: "Service", rate: 0, conversations: 0, spend: 0 },
        ],
        transactions,
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
  rechargeWallet,
  getBusinessProfile,
  updateBusinessProfile,
  verifyPhoneNumber,
};
