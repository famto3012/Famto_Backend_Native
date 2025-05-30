const mongoose = require("mongoose");

const workingTimeSchema = new mongoose.Schema({
  startTime: {
    type: String,
    required: true,
  },
  endTime: {
    type: String,
    required: true,
  },
});

const agentAppCustomizationSchema = new mongoose.Schema(
  {
    splashScreenUrl: {
      type: String,
      required: true,
    },
    email: {
      type: Boolean,
      default: true,
    },
    phoneNumber: {
      type: Boolean,
      default: true,
    },
    emailVerification: {
      type: Boolean,
      default: true,
    },
    otpVerification: {
      type: Boolean,
      default: true,
    },
    loginViaOtp: {
      type: Boolean,
      default: true,
    },
    loginViaGoogle: {
      type: Boolean,
      default: true,
    },
    loginViaApple: {
      type: Boolean,
      default: true,
    },
    loginViaFacebook: {
      type: Boolean,
      default: true,
    },
    workingTime: [workingTimeSchema],
    appUpdateType: {
      type: String,
      enum: ["IMMEDIATE", "FLEXIBLE"],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AgentAppCustomization = mongoose.model(
  "AgentAppCustomization",
  agentAppCustomizationSchema
);
module.exports = AgentAppCustomization;
