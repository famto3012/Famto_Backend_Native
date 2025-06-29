const { validationResult } = require("express-validator");

const CustomerPricing = require("../../../models/CustomerPricing");

const appError = require("../../../utils/appError");

const addCustomerPricingController = async (req, res, next) => {
  const {
    deliveryMode,
    ruleName,
    baseFare,
    baseDistance,
    fareAfterBaseDistance,
    baseWeightUpto,
    fareAfterBaseWeight,
    purchaseFarePerHour,
    waitingFare,
    waitingTime,
    geofenceId,
    vehicleType,
    businessCategoryId,
    merchants,
  } = req.body;

  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

    const ruleNameFound = await CustomerPricing.findOne({
      ruleName: { $regex: `^${normalizedRuleName}$`, $options: "i" },
    });

    if (ruleNameFound) {
      formattedErrors.ruleName = "Rule name already exists for the order type";
      return res.status(409).json({ errors: formattedErrors });
    }

    const existingMerchant = await CustomerPricing.findOne({
      merchants: { $in: merchants },
      businessCategoryId,
    });

    if (existingMerchant) {
      const duplicateMerchants = existingMerchant.merchants.filter((merchant) =>
        merchants.includes(merchant.toString())
      );

      return res.status(409).json({
        errors: {
          merchants: duplicateMerchants,
        },
      });
    }

    let newRule = await CustomerPricing.create({
      deliveryMode,
      ruleName: normalizedRuleName,
      baseFare,
      baseDistance,
      fareAfterBaseDistance,
      baseWeightUpto,
      fareAfterBaseWeight,
      purchaseFarePerHour,
      waitingFare,
      waitingTime,
      geofenceId,
      vehicleType,
      businessCategoryId: businessCategoryId || null,
      merchants,
    });

    if (!newRule) {
      return next(appError("Error in creating new rule"));
    }

    newRule = await newRule.populate("geofenceId", "name");

    res.status(201).json({
      message: `${normalizedRuleName} created successfully`,
      data: newRule,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllCustomerPricingController = async (req, res, next) => {
  try {
    const allCustomerPricings = await CustomerPricing.find({}).populate(
      "geofenceId",
      "name"
    );

    res.status(200).json({
      message: "All customer pricings",
      data: allCustomerPricings,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleCustomerPricingController = async (req, res, next) => {
  try {
    const pricing = await CustomerPricing.findById(
      req.params.customerPricingId
    ).lean();

    if (!pricing) {
      return next(appError("Customer pricing not found", 404));
    }

    res.status(200).json({
      message: "Single customer pricing",
      data: pricing,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editCustomerPricingController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const { customerPricingId } = req.params;

    const customerPricingFound = await CustomerPricing.findById(
      customerPricingId
    );

    if (!customerPricingFound) {
      return next(appError("Customer pricing not found", 404));
    }

    const {
      deliveryMode,
      ruleName,
      baseFare,
      baseDistance,
      fareAfterBaseDistance,
      baseWeightUpto,
      fareAfterBaseWeight,
      purchaseFarePerHour,
      waitingFare,
      waitingTime,
      geofenceId,
      vehicleType,
      businessCategoryId,
      merchants,
    } = req.body;

    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

    const ruleNameFound = await CustomerPricing.findOne({
      _id: { $ne: customerPricingId },
      ruleName: { $regex: `^${normalizedRuleName}$`, $options: "i" },
    });

    if (ruleNameFound) {
      formattedErrors.ruleName = "Rule name already exists for the order type";
      return res.status(409).json({ errors: formattedErrors });
    }

    const existingMerchant = await CustomerPricing.findOne({
      _id: { $ne: customerPricingId },
      businessCategoryId,
      merchants: { $in: merchants },
    });

    if (
      existingMerchant &&
      ["Take Away", "Home Delivery"].includes(existingMerchant.deliveryMode)
    ) {
      const duplicateMerchants = existingMerchant.merchants.filter((merchant) =>
        merchants.includes(merchant)
      );

      return res.status(409).json({
        errors: {
          merchants: duplicateMerchants,
        },
      });
    }

    let updatedCustomerPricing = await CustomerPricing.findByIdAndUpdate(
      customerPricingId,
      {
        deliveryMode,
        ruleName: normalizedRuleName,
        baseFare,
        baseDistance,
        fareAfterBaseDistance,
        baseWeightUpto,
        fareAfterBaseWeight,
        purchaseFarePerHour,
        waitingFare,
        waitingTime,
        geofenceId,
        vehicleType,
        businessCategoryId: businessCategoryId || null,
        merchants,
      },
      { new: true }
    );

    if (!updatedCustomerPricing) {
      return next(appError("Error in updating customer pricing"));
    }

    updatedCustomerPricing = await updatedCustomerPricing.populate(
      "geofenceId",
      "name"
    );

    res.status(200).json({
      message: `${normalizedRuleName} updated successfully`,
      data: updatedCustomerPricing,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteCustomerPricingController = async (req, res, next) => {
  try {
    const customerPricingFound = await CustomerPricing.findById(
      req.params.customerPricingId
    );

    if (!customerPricingFound) {
      return next(appError("Customer pricing not found", 404));
    }

    await CustomerPricing.findByIdAndDelete(req.params.customerPricingId);

    res.status(200).json({ message: "Rule deleted successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const changeStatusCustomerPricingController = async (req, res, next) => {
  try {
    const customerPricingFound = await CustomerPricing.findById(
      req.params.customerPricingId
    );

    if (!customerPricingFound) {
      return next(appError("Customer pricing not found", 404));
    }

    // Toggle the status
    customerPricingFound.status = !customerPricingFound.status;
    await customerPricingFound.save();

    res.status(200).json({
      message: "Customer pricing status updated successfully",
      data: customerPricingFound.status,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addCustomerPricingController,
  getAllCustomerPricingController,
  getSingleCustomerPricingController,
  editCustomerPricingController,
  deleteCustomerPricingController,
  changeStatusCustomerPricingController,
};
