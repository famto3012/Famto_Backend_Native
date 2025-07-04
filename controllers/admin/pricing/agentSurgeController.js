const { validationResult } = require("express-validator");

const AgentSurge = require("../../../models/AgentSurge");

const appError = require("../../../utils/appError");

const addAgentSurgeController = async (req, res, next) => {
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
      baseDistance,
      waitingFare,
      waitingTime,
      geofenceId,
    } = req.body;

    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

    const ruleNameFound = await AgentSurge.findOne({
      ruleName: new RegExp(`^${normalizedRuleName}$`, "i"),
    });

    if (ruleNameFound) {
      formattedErrors.ruleName = "Rule name already exists";
      return res.status(409).json({ errors: formattedErrors });
    }

    let newRule = await AgentSurge.create({
      ruleName,
      baseFare,
      baseDistance,
      waitingFare,
      waitingTime,
      geofenceId,
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

const getAllAgentSurgeController = async (req, res, next) => {
  try {
    const allSurge = await AgentSurge.find({}).populate("geofenceId", "name");

    res.status(200).json({
      message: "All customer surge",
      data: allSurge,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const getSingleAgentSurgeController = async (req, res, next) => {
  try {
    const surge = await AgentSurge.findById(req.params.agentSurgeId);

    if (!surge) {
      return next(appError("Agent surge not found", 404));
    }

    res.status(200).json({
      message: "Single customer surge",
      data: surge,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const editAgentSurgeController = async (req, res, next) => {
  const {
    ruleName,
    baseFare,
    baseDistance,
    waitingFare,
    waitingTime,
    geofenceId,
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
    const agentSurgeFound = await AgentSurge.findById(
      req.params.agentSurgeId
    ).populate("geofenceId", "name");

    if (!agentSurgeFound) {
      return next(appError("Agent surge not found", 404));
    }

    const normalizedRuleName = ruleName
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const normalizedDBRuleName = agentSurgeFound.ruleName
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();

    if (normalizedRuleName !== normalizedDBRuleName) {
      const ruleNameFound = await AgentSurge.findOne({
        ruleName: new RegExp(`^${normalizedRuleName}$`, "i"),
      });

      if (ruleNameFound) {
        formattedErrors.ruleName = "Rule name already exists";
        return res.status(409).json({ errors: formattedErrors });
      }
    }

    let updatedAgentSurge = await AgentSurge.findByIdAndUpdate(
      req.params.agentSurgeId,
      {
        ruleName,
        baseFare,
        baseDistance,
        waitingFare,
        waitingTime,
        geofenceId,
      },
      { new: true }
    );

    if (!updatedAgentSurge) {
      return next(appError("Error in updating agent surge"));
    }

    updatedAgentSurge = await updatedAgentSurge.populate("geofenceId", "name");

    res.status(200).json({
      message: `${ruleName} updated successfully`,
      data: updatedAgentSurge,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

const deleteAgentSurgeController = async (req, res, next) => {
  try {
    const agentSurgeFound = await AgentSurge.findById(req.params.agentSurgeId);

    if (!agentSurgeFound) {
      return next(appError("Agent surge not found", 404));
    }

    await AgentSurge.findByIdAndDelete(req.params.agentSurgeId);

    res.status(200).json({ message: "Rule deleted successfully" });
  } catch (err) {
    next(appError(err.message));
  }
};

const changeStatusAgentSurgeController = async (req, res, next) => {
  try {
    const agentSurgeFound = await AgentSurge.findById(req.params.agentSurgeId);

    if (!agentSurgeFound) {
      return next(appError("Agent surge not found", 404));
    }

    // Toggle the status
    agentSurgeFound.status = !agentSurgeFound.status;
    await agentSurgeFound.save();

    res.status(200).json({
      message: "Agent surge status updated successfully",
      data: agentSurgeFound.status,
    });
  } catch (err) {
    next(appError(err.message));
  }
};

module.exports = {
  addAgentSurgeController,
  getAllAgentSurgeController,
  getSingleAgentSurgeController,
  editAgentSurgeController,
  deleteAgentSurgeController,
  changeStatusAgentSurgeController,
};
