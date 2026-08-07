const Razorpay = require("razorpay");
const MerchantWalletBalance = require("../../models/MerchantWalletBalance");
const MerchantWalletTransaction = require("../../models/MerchantWalletTransaction");
const MerchantPaymentConfig = require("../../models/MerchantPaymentConfig");
const appError = require("../../utils/appError");

/**
 * Credit merchant wallet when payment is captured (webhook or verify)
 * Called from webhook/verify after payment success.
 */
const creditMerchantWallet = async (merchantId, amount, orderId, temporaryOrderId, razorpayOrderId, razorpayPaymentId, mode) => {
  try {
    // Update balance atomically
    const balance = await MerchantWalletBalance.findOneAndUpdate(
      { merchantId },
      { $inc: { balance: amount } },
      { upsert: true, new: true }
    );

    // Create transaction record
    const transaction = await MerchantWalletTransaction.create({
      merchantId,
      orderId,
      temporaryOrderId,
      razorpayOrderId,
      razorpayPaymentId,
      mode,
      amount,
      type: "credit",
      status: "completed",
      description: `Payment received${mode === "Own" ? " (tracking only)" : " (platform account)"}`,
      processedAt: new Date(),
    });

    return { balance, transaction };
  } catch (err) {
    console.error("[creditMerchantWallet] Error:", err.message);
    throw err;
  }
};

/**
 * Process auto-payout for a merchant.
 * Scans wallet balances with pending amounts and initiates Razorpay payout.
 */
const processMerchantPayout = async (merchantId) => {
  const balance = await MerchantWalletBalance.findOne({ merchantId });
  if (!balance || balance.balance <= 0) {
    return { success: false, message: "No balance to payout" };
  }

  const config = await MerchantPaymentConfig.findOne({ merchantId });
  if (!config || config.mode !== "Platform" || !config.bankDetails?.accountNumber || !config.bankDetails?.ifsc) {
    return { success: false, message: "No valid bank details for payout" };
  }

  const payoutAmount = balance.balance; // in rupees
  const amountInPaise = Math.round(payoutAmount * 100);

  if (amountInPaise < 100) { // Minimum ₹1
    return { success: false, message: "Balance too low for payout" };
  }

  const client = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  try {
    // Mark pending
    balance.balance = 0;
    balance.pendingPayout = payoutAmount;
    await balance.save();

    // Create Razorpay payout
    const payout = await client.payouts.create({
      account_number: config.bankDetails.accountNumber,
      fund_account_id: await getOrCreateFundAccount(client, config),
      amount: amountInPaise,
      currency: "INR",
      mode: "IMPS",
      purpose: "refund",
      narration: `Famto payout for merchant ${merchantId}`,
      queue_if_low_balance: true,
    });

    // Create transaction record
    await MerchantWalletTransaction.create({
      merchantId,
      amount: payoutAmount,
      type: "debit",
      mode: "Platform",
      status: "payout_initiated",
      payoutId: payout.id,
      description: `Auto-payout initiated`,
    });

    // Update balance with payout info
    balance.pendingPayout = 0;
    balance.lastPayoutAt = new Date();
    balance.lastPayoutId = payout.id;
    await balance.save();

    return { success: true, payoutId: payout.id, amount: payoutAmount };
  } catch (err) {
    // Rollback balance on failure
    balance.balance = payoutAmount;
    balance.pendingPayout = 0;
    await balance.save();

    await MerchantWalletTransaction.create({
      merchantId,
      amount: payoutAmount,
      type: "debit",
      mode: "Platform",
      status: "payout_failed",
      payoutFailureReason: err.message,
      description: `Auto-payout failed: ${err.message}`,
    });

    console.error("[processMerchantPayout] Error:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Get or create Razorpay fund account for a merchant's bank details.
 */
const getOrCreateFundAccount = async (client, config) => {
  // Check if we have a cached fund account ID (could store in MerchantPaymentConfig)
  if (config.fundAccountId) {
    return config.fundAccountId;
  }

  // Create fund account
  const fundAccount = await client.fundAccounts.create({
    account_type: "bank_account",
    bank_account: {
      name: config.bankDetails.accountName,
      ifsc: config.bankDetails.ifsc,
      account_number: config.bankDetails.accountNumber,
    },
    contact: {
      name: config.bankDetails.accountName,
      email: "payouts@famto.in",
      contact: "9999999999",
      type: "merchant",
    },
  });

  config.fundAccountId = fundAccount.id;
  await config.save();

  return fundAccount.id;
};

/**
 * Manual payout trigger (admin or merchant)
 */
const triggerManualPayout = async (merchantId) => {
  return await processMerchantPayout(merchantId);
};

/**
 * Get merchant wallet details (for dashboard)
 */
const getMerchantWallet = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const balance = await MerchantWalletBalance.findOne({ merchantId }).lean();
    const transactions = await MerchantWalletTransaction.find({ merchantId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        balance: balance?.balance || 0,
        pendingPayout: balance?.pendingPayout || 0,
        lastPayoutAt: balance?.lastPayoutAt,
        lastPayoutId: balance?.lastPayoutId,
        transactions,
      },
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

/**
 * Request payout (merchant-initiated)
 */
const requestPayout = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const result = await processMerchantPayout(merchantId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message || result.error });
    }
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  creditMerchantWallet,
  processMerchantPayout,
  triggerManualPayout,
  getMerchantWallet,
  requestPayout,
};