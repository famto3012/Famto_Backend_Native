const { v4: uuidv4 } = require("uuid");

const Merchant = require("../../models/Merchant");
const ApiKey = require("../../models/ApiKeys");

const appError = require("../../utils/appError");

const generateApiKey = async (req, res, next) => {
  try {
    const { merchantId } = req.body;

    if (!merchantId) {
      return next(appError("merchantId is required", 400));
    }

    const merchant = await Merchant.findById(merchantId);
    if (!merchant) {
      return next(appError("Merchant not found", 404));
    }

    let apiKey = await ApiKey.findOne({ merchantId });

    if (apiKey) {
      return res.status(200).json({
        success: true,
        apiKey: apiKey.apiKey,
      });
    }

    const newApiKey = `${uuidv4()}-${merchant._id.toLowerCase()}`;

    const createdKey = await ApiKey.create({
      merchantId,
      apiKey: newApiKey,
    });

    return res.status(201).json({
      success: true,
      apiKey: createdKey.apiKey,
    });
  } catch (err) {
    return next(appError(err.message, 500));
  }
};

module.exports = { generateApiKey };
