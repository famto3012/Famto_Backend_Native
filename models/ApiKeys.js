const mongoose = require("mongoose");

const apiKey = new mongoose.Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
    },
    apiKey: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const ApiKey = mongoose.model("ApiKey", apiKey);
module.exports = ApiKey;
