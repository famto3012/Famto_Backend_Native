const Merchant = require("../../../models/Merchant");
const appError = require("../../../utils/appError");

const buildFallbackUrl = (merchant) => {
  const businessCategoryId = merchant.merchantDetail?.businessCategoryId;
  return `https://order.famto.in/merchant/${merchant._id}/${
    businessCategoryId || ""
  }/products`;
};

// GET /api/v1/merchants/qr-config
// Returns the merchant's configured QR target URL (fallback: Famto products
// page) plus the pieces the QR card needs to render.
const getMerchantQrConfigController = async (req, res, next) => {
  try {
    const merchant = await Merchant.findById(req.merchantId)
      .select(
        "merchantDetail.qrUrl merchantDetail.businessCategoryId merchantDetail.merchantName"
      )
      .lean();

    if (!merchant) return next(appError("Merchant not found", 404));

    res.status(200).json({
      success: true,
      qrUrl: merchant.merchantDetail?.qrUrl || null,
      fallbackUrl: buildFallbackUrl(merchant),
      businessCategoryId: merchant.merchantDetail?.businessCategoryId || null,
      merchantName: merchant.merchantDetail?.merchantName || null,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

// PUT /api/v1/merchants/qr-config
// Sets the merchant's QR target URL. Empty string clears back to the fallback.
const updateMerchantQrConfigController = async (req, res, next) => {
  try {
    const qrUrl = (req.body.qrUrl || "").trim();

    if (qrUrl) {
      if (!/^https?:\/\//i.test(qrUrl)) {
        return next(appError("qrUrl must be an http(s) URL", 400));
      }
      try {
        new URL(qrUrl);
      } catch {
        return next(appError("qrUrl must be a valid URL", 400));
      }
    }

    const merchant = await Merchant.findById(req.merchantId);
    if (!merchant) return next(appError("Merchant not found", 404));
    if (!merchant.merchantDetail) merchant.merchantDetail = {};

    merchant.merchantDetail.qrUrl = qrUrl || null;
    await merchant.save();

    res.status(200).json({
      success: true,
      message: "QR URL updated",
      qrUrl: merchant.merchantDetail.qrUrl,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getMerchantQrConfigController,
  updateMerchantQrConfigController,
};
