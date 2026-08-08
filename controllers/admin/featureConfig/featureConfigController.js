const appError = require("../../../utils/appError");
const PlatformFeatureConfig = require("../../../models/PlatformFeatureConfig");
const MerchantFeatureOverride = require("../../../models/MerchantFeatureOverride");
const { invalidateFeatureCache } = require("../../../utils/featureConfig");
const Merchant = require("../../../models/Merchant");

// ── Global config (admin UI) ──

const getPlatformFeatureConfig = async (req, res, next) => {
  try {
    const config = await PlatformFeatureConfig.findOne({}).lean();
    if (!config) {
      return res.status(200).json({
        success: true,
        data: {
          gateways: {
            razorpay: { enabled: true, sortOrder: 0 },
            cashfree: { enabled: true, sortOrder: 1 },
            phonepe: { enabled: true, sortOrder: 2 },
          },
          selfPaymentOption: true,
          whatsapp: { enabled: true },
          delivery: { enabled: true },
        },
        message: "Using default config (no singleton doc exists yet)",
      });
    }
    res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const updatePlatformFeatureConfig = async (req, res, next) => {
  try {
    const updates = req.body;
    let config = await PlatformFeatureConfig.findOne({});

    if (config) {
      Object.assign(config, updates);
      await config.save();
    } else {
      config = await PlatformFeatureConfig.create(updates);
    }

    // Clear cache for all merchants + global
    invalidateFeatureCache();

    res.status(200).json({
      success: true,
      data: config.toObject(),
      message: "Feature config updated",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// ── Merchant overrides (admin table + per-merchant edit) ──

const getMerchantFeatureOverrides = async (req, res, next) => {
  try {
    const overrides = await MerchantFeatureOverride.find({}).lean();
    res.status(200).json({ success: true, data: overrides });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const getMerchantFeatureOverride = async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    const override = await MerchantFeatureOverride.findOne({ merchantId }).lean();
    res.status(200).json({ success: true, data: override || null });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

const upsertMerchantFeatureOverride = async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    const updates = req.body;

    // Ensure the merchant exists
    const merchant = await Merchant.findOne({ _id: merchantId }).select("_id").lean();
    if (!merchant) {
      return next(appError("Merchant not found", 404));
    }

    let override = await MerchantFeatureOverride.findOne({ merchantId });
    if (override) {
      Object.assign(override, updates);
      await override.save();
    } else {
      override = await MerchantFeatureOverride.create({ merchantId, ...updates });
    }

    // Clear this merchant's cache only
    invalidateFeatureCache(merchantId);

    res.status(200).json({
      success: true,
      data: override.toObject(),
      message: "Merchant feature override saved",
    });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

// ── Merchant read (UI gating) ──

const getMerchantFeatureConfig = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { getEffectiveConfig } = require("../../../utils/featureConfig");
    const config = await getEffectiveConfig(merchantId);
    res.status(200).json({ success: true, data: config });
  } catch (err) {
    next(appError(err.message, 500));
  }
};

module.exports = {
  getPlatformFeatureConfig,
  updatePlatformFeatureConfig,
  getMerchantFeatureOverrides,
  getMerchantFeatureOverride,
  upsertMerchantFeatureOverride,
  getMerchantFeatureConfig,
};
