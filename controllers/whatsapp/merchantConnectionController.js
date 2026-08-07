const crypto = require("crypto");
const WhatsappConnection = require("../../models/WhatsappConnection");
const appError = require("../../utils/appError");

// ─── Merchant Connection Onboarding ─────────────────────────────
//
// Model A (Platform WABA) — the platform registers the number under its WABA,
// triggers OTP, merchant enters OTP → status becomes Active.
// This is a scaffold; the actual Meta registration call is platform-side.

const getMerchantConnection = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const connection = await WhatsappConnection.findOne({ merchantId }).lean();
    if (!connection) {
      return res.status(200).json({ success: true, data: null, message: "No connection configured" });
    }
    res.status(200).json({ success: true, data: connection });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const requestMerchantConnection = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { phoneNumber, displayName, mode = "PlatformWABA" } = req.body;

    if (!phoneNumber) {
      return next(appError("Phone number is required", 400));
    }

    // Check if merchant already has a connection
    const existing = await WhatsappConnection.findOne({ merchantId });
    if (existing) {
      return next(appError("Connection already exists. Current status: " + existing.status, 400));
    }

    // Normalize phone number: remove +, ensure country code
    let cleanPhone = String(phoneNumber).replace(/^\+/, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    // Create connection record (status Pending)
    // phoneNumberId, wabaId, token will be filled by platform after Meta registration
    const connection = await WhatsappConnection.create({
      merchantId,
      phoneNumber: cleanPhone,
      displayName: displayName || "Famto Merchant",
      mode,
      status: "Pending",
    });

    // TODO: Platform-side Meta registration flow
    // - If mode === "PlatformWABA": call Meta WABA API to register phoneNumber
    // - Meta sends OTP to the phone number via SMS/call
    // - Merchant receives OTP, enters in dashboard → verifyMerchantConnectionOtp

    res.status(201).json({
      success: true,
      data: connection,
      message: "Connection requested. OTP will be sent to the phone number for verification.",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const verifyMerchantConnectionOtp = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { otp, phoneNumberId } = req.body;

    if (!otp || !phoneNumberId) {
      return next(appError("OTP and phoneNumberId are required", 400));
    }

    const connection = await WhatsappConnection.findOne({ merchantId });
    if (!connection) {
      return next(appError("No pending connection found", 404));
    }

    if (connection.status !== "Pending") {
      return next(appError("Connection is not in Pending state", 400));
    }

    // TODO: Platform-side OTP verification with Meta
    // For PlatformWABA mode, this would call Meta's verify OTP endpoint
    // For now, we simulate success and mark Active

    // In production: call Meta's /{phone_number_id}/verify_otp with the OTP
    // const metaRes = await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/verify_otp`, { code: otp }, { headers: ... });
    // const { token, business_account_id } = metaRes.data;

    connection.phoneNumberId = phoneNumberId;
    connection.wabaId = "platform_waba_id"; // from Meta response
    connection.token = crypto.randomBytes(32).toString("hex"); // platform generates token for this number
    connection.status = "Active";
    connection.verifiedAt = new Date();
    await connection.save();

    res.status(200).json({
      success: true,
      data: connection,
      message: "WhatsApp number verified and active!",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantConnection,
  requestMerchantConnection,
  verifyMerchantConnectionOtp,
};