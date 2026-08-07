const appError = require("../../../utils/appError");
const Merchant = require("../../../models/Merchant");

const getOwnDeliveryController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;

    const merchant = await Merchant.findById(merchantId).select(
      "merchantDetail.hasOwnDelivery"
    );

    if (!merchant) return next(appError("Merchant not found", 404));

    res.status(200).json({
      hasOwnDelivery: !!merchant?.merchantDetail?.hasOwnDelivery,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const updateOwnDeliveryController = async (req, res, next) => {
  try {
    const merchantId = req.merchantId;
    const { hasOwnDelivery } = req.body;

    if (typeof hasOwnDelivery !== "boolean") {
      return next(appError("hasOwnDelivery must be a boolean", 400));
    }

    const merchant = await Merchant.findById(merchantId);

    if (!merchant) return next(appError("Merchant not found", 404));

    // Merchant may have no merchantDetail subdoc yet (minimize omits it).
    if (!merchant.merchantDetail) merchant.merchantDetail = {};

    merchant.merchantDetail.hasOwnDelivery = hasOwnDelivery;

    await merchant.save();

    res.status(200).json({
      hasOwnDelivery: merchant.merchantDetail.hasOwnDelivery,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  getOwnDeliveryController,
  updateOwnDeliveryController,
};