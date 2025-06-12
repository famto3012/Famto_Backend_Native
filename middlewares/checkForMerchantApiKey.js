const ApiKey = require("../models/ApiKeys");
const appError = require("../utils/appError");

const checkForMerchantApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return next(appError("API key missing", 403));
    }

    const merchant = await ApiKey.findOne({ apiKey });

    if (!merchant || !merchant.merchantId) {
      return next(appError("Invalid API Key", 400));
    }

    req.merchantId = merchant.merchantId;

    next();
  } catch (err) {
    return next(appError(err.message, 500));
  }
};

module.exports = { checkForMerchantApiKey };
