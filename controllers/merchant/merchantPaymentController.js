const MerchantPaymentConfig = require("../../models/MerchantPaymentConfig");
const appError = require("../../utils/appError");

const getMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const config = await MerchantPaymentConfig.findOne({ merchantId })
      .select("-keySecret")
      .lean();

    if (!config) {
      return res.status(200).json({
        success: true,
        data: { mode: "Platform", status: "Inactive" },
        message: "No payment config found. Using platform Razorpay.",
      });
    }

    res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updateMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { keyId, keySecret, mode, bankDetails } = req.body;

    if (!keyId || !keySecret) {
      return next(appError("keyId and keySecret are required", 400));
    }

    if (mode === "Own" && (!bankDetails?.accountName || !bankDetails?.accountNumber || !bankDetails?.ifsc)) {
      return next(appError("Bank details required for Own mode", 400));
    }

    let config = await MerchantPaymentConfig.findOne({ merchantId });

    if (config) {
      config.keyId = keyId;
      config.keySecret = keySecret;
      config.mode = mode || "Own";
      config.bankDetails = bankDetails;
      config.status = "Active";
      await config.save();
    } else {
      config = await MerchantPaymentConfig.create({
        merchantId,
        keyId,
        keySecret,
        mode: mode || "Own",
        bankDetails,
        status: "Active",
      });
    }

    const responseConfig = config.toObject();
    delete responseConfig.keySecret;

    res.status(200).json({
      success: true,
      data: responseConfig,
      message: "Payment config saved. Test a payment to validate.",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const testMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const config = await MerchantPaymentConfig.findOne({ merchantId });

    if (!config || config.mode !== "Own" || config.status !== "Active") {
      return next(appError("No valid Own-mode config found", 400));
    }

    const Razorpay = require("razorpay");
    const keySecret = config.getDecryptedKeySecret();
    if (!keySecret) {
      config.status = "Invalid";
      await config.save();
      return next(appError("Decryption failed. Re-enter credentials.", 500));
    }

    const client = new Razorpay({ key_id: config.keyId, key_secret: keySecret });

    // Test by creating a small order (₹1 = 100 paise)
    const testOrder = await client.orders.create({
      amount: 100,
      currency: "INR",
      receipt: `test_${Date.now()}`,
    });

    config.status = "Active";
    config.validatedAt = new Date();
    await config.save();

    res.status(200).json({
      success: true,
      message: "Razorpay credentials validated successfully",
      data: { testOrderId: testOrder.id },
    });
  } catch (err) {
    // If validation fails, mark as Invalid
    await MerchantPaymentConfig.findOneAndUpdate(
      { merchantId: req.merchantId },
      { status: "Invalid" }
    );
    next(appError(`Validation failed: ${err.message}`, 500));
  }
};

const disableMerchantPaymentConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    await MerchantPaymentConfig.findOneAndUpdate(
      { merchantId },
      { mode: "Platform", status: "Inactive" }
    );
    res.status(200).json({ success: true, message: "Switched to platform Razorpay" });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getMerchantPaymentConfig,
  updateMerchantPaymentConfig,
  testMerchantPaymentConfig,
  disableMerchantPaymentConfig,
};