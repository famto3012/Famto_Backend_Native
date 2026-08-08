const WhatsappConnection = require("../../models/WhatsappConnection");
const appError = require("../../utils/appError");
const { fetchBusinessProfile } = require("../../utils/whatsappApi");

// ─── Merchant Connection (OwnWABA) ──────────────────────────────
//
// Each merchant connects their OWN WhatsApp Business number by pasting their
// Meta credentials (phoneNumberId + wabaId + access token). No platform OTP
// flow — the number is registered and verified on Meta's side by the merchant.
// Famto stores the token encrypted and validates it with a live Meta call
// (fetchBusinessProfile) before marking the connection Active.

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

// PUT /connection — save (or overwrite) the merchant's own Meta credentials.
// token is encrypted at rest via the model pre-save hook. Saving resets status
// to Pending until the merchant runs /connection/test to validate against Meta.
const saveMerchantConnection = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const {
      phoneNumber,
      phoneNumberId,
      wabaId,
      token,
      displayName,
      mode = "OwnWABA",
    } = req.body;

    if (!phoneNumber) {
      return next(appError("Phone number is required", 400));
    }
    if (!phoneNumberId) {
      return next(appError("phoneNumberId is required (from your Meta WhatsApp Business account)", 400));
    }

    // Normalize phone number: strip +, ensure country code
    let cleanPhone = String(phoneNumber).replace(/^\+/, "");
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    const existing = await WhatsappConnection.findOne({ merchantId });

    let connection;
    if (existing) {
      existing.phoneNumber = cleanPhone;
      existing.phoneNumberId = phoneNumberId;
      // wabaId doubles as the Meta business account id for template APIs.
      existing.wabaId = wabaId || existing.wabaId;
      existing.businessAccountId = wabaId || existing.businessAccountId;
      existing.displayName = displayName || existing.displayName;
      existing.mode = mode;
      if (token) existing.token = token;
      // Credentials changed — re-validate before re-activating.
      existing.status = "Pending";
      existing.verifiedAt = undefined;
      connection = existing;
    } else {
      connection = new WhatsappConnection({
        merchantId,
        phoneNumber: cleanPhone,
        phoneNumberId,
        wabaId,
        businessAccountId: wabaId,
        displayName: displayName || "Famto Merchant",
        mode,
        token,
        status: "Pending",
      });
    }

    await connection.save();

    res.status(existing ? 200 : 201).json({
      success: true,
      data: { ...connection.toObject(), token: undefined },
      message: "Connection saved. Test the credentials to activate.",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// POST /connection/test — validate the stored credentials with a live Meta call.
// Success → status Active + verifiedAt. Failure → status Failed.
const testMerchantConnection = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const connection = await WhatsappConnection.findOne({ merchantId }).select("+token");
    if (!connection) {
      return next(appError("No connection configured. Save your credentials first.", 400));
    }

    const token = connection.getDecryptedToken();
    if (!token) {
      connection.status = "Failed";
      await connection.save();
      return next(appError("Failed to decrypt token. Re-enter your credentials.", 400));
    }

    // Build a sendable config for the Meta call (whatsappApi.resolveConfig
    // expects a plaintext token).
    const sendable = {
      phoneNumberId: connection.phoneNumberId,
      token,
      businessAccountId: connection.businessAccountId || connection.wabaId,
    };

    try {
      await fetchBusinessProfile(sendable);
    } catch (err) {
      connection.status = "Failed";
      connection.verifiedAt = undefined;
      await connection.save();
      return next(
        appError(
          "Invalid WhatsApp credentials: " +
            (err.response?.data?.error?.message || err.message),
          400
        )
      );
    }

    connection.status = "Active";
    connection.verifiedAt = new Date();
    await connection.save();

    res.status(200).json({
      success: true,
      data: { ...connection.toObject(), token: undefined },
      message: "WhatsApp number verified and active!",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantConnection,
  saveMerchantConnection,
  testMerchantConnection,
};
