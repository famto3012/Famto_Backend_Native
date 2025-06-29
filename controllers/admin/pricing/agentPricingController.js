const { validationResult } = require("express-validator");

const AgentPricing = require("../../../models/AgentPricing");

const appError = require("../../../utils/appError");

const addAgentPricingController = async (req, res, next) => {
  const errors = validationResult(req);

  let formattedErrors = {};
  if (!errors.isEmpty()) {
    errors.array().forEach((error) => {
      formattedErrors[error.path] = error.msg;
    });
    return res.status(500).json({ errors: formattedErrors });
  }

  try {
    const {
      ruleName,
      baseFare,
      baseDistanceFarePerKM,
      startToPickFarePerKM,
      waitingFare,
      waitingTime,
      purchaseFarePerHour,
      minLoginHours,
      minOrderNumber,
      fareAfterMinLoginHours,
      fareAfterMinOrderNumber,
      geofenceId,
      type,
    } = req.body;

    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

    const ruleNameFound = await AgentPricing.findOne({
      ruleName: new RegExp(`^${normalizedRuleName}$`, "i"),
    });

    if (ruleNameFound) {
      formattedErrors.ruleName = "Rule name already exists";
      return res.status(409).json({ errors: formattedErrors });
    }

    let newRule = await AgentPricing.create({
      ruleName,
      baseFare,
      baseDistanceFarePerKM,
      startToPickFarePerKM,
      waitingFare,
      waitingTime,
      purchaseFarePerHour,
      minLoginHours,
      minOrderNumber,
      fareAfterMinLoginHours,
      fareAfterMinOrderNumber,
      geofenceId,
      type,
    });

    if (!newRule) {
      return next(appError("Error in creating new rule"));
    }

    newRule = await newRule.populate("geofenceId", "name");

    res.status(201).json({
      message: `${ruleName} created successfully`,
      data: newRule,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getAllAgentPricingController = async (req, res, next) => {
  try {
    const pricing = await AgentPricing.find({}).populate("geofenceId", "name");

    res.status(200).json({
      message: "All agent pricings",
      data: pricing,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleAgentPricingController = async (req, res, next) => {
  try {
    const pricing = await AgentPricing.findById(req.params.agentPricingId);

    if (!pricing) {
      return next(appError("Agent pricing not found", 404));
    }

    res.status(200).json({
      message: "Single agent pricing",
      data: pricing,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editAgentPricingController = async (req, res, next) => {
  const {
    ruleName,
    baseFare,
    baseDistanceFarePerKM,
    startToPickFarePerKM,
    waitingFare,
    waitingTime,
    purchaseFarePerHour,
    minLoginHours,
    minOrderNumber,
    fareAfterMinLoginHours,
    fareAfterMinOrderNumber,
    geofenceId,
    type,
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
    const agentPricingFound = await AgentPricing.findById(
      req.params.agentPricingId
    ).populate("geofenceId", "name");

    if (!agentPricingFound) {
      return next(appError("Agent pricing not found", 404));
    }

    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

    const ruleNameFound = await AgentPricing.findOne({
      _id: { $ne: req.params.agentPricingId },
      ruleName: new RegExp(`^${normalizedRuleName}$`, "i"),
    });

    if (ruleNameFound) {
      formattedErrors.ruleName = "Rule name already exists";
      return res.status(409).json({ errors: formattedErrors });
    }

    let updatedAgentPricing = await AgentPricing.findByIdAndUpdate(
      req.params.agentPricingId,
      {
        ruleName,
        baseFare,
        baseDistanceFarePerKM,
        startToPickFarePerKM,
        waitingFare,
        waitingTime,
        purchaseFarePerHour,
        minLoginHours,
        minOrderNumber,
        fareAfterMinLoginHours,
        fareAfterMinOrderNumber,
        geofenceId,
        type,
      },
      { new: true }
    );

    if (!updatedAgentPricing) {
      return next(appError("Error in updating agent pricing"));
    }

    updatedAgentPricing = await updatedAgentPricing.populate(
      "geofenceId",
      "name"
    );

    res.status(200).json({
      message: `${ruleName} updated successfully`,
      data: updatedAgentPricing,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteAgentPricingController = async (req, res, next) => {
  try {
    const agentPricingFound = await AgentPricing.findById(
      req.params.agentPricingId
    );

    if (!agentPricingFound) {
      return next(appError("Agent pricing not found", 404));
    }

    await AgentPricing.findByIdAndDelete(req.params.agentPricingId);

    res.status(200).json({ message: "Rule deleted successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const changeStatusAgentPricingController = async (req, res, next) => {
  try {
    const agentPricingFound = await AgentPricing.findById(
      req.params.agentPricingId
    );

    if (!agentPricingFound) {
      return next(appError("Agent pricing not found", 404));
    }

    // Toggle the status
    agentPricingFound.status = !agentPricingFound.status;
    await agentPricingFound.save();

    res.status(200).json({
      message: "Agent pricing status updated successfully",
      data: agentPricingFound.status,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addAgentPricingController,
  getAllAgentPricingController,
  getSingleAgentPricingController,
  editAgentPricingController,
  deleteAgentPricingController,
  changeStatusAgentPricingController,
};
