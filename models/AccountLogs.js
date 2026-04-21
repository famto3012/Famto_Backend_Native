const mongoose = require("mongoose");

const accountLogsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    fullName: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

accountLogsSchema.index({ userId: 1, createdAt: -1 });
accountLogsSchema.index({ createdAt: -1 });

const AccountLogs = mongoose.model("AccountLogs", accountLogsSchema);
module.exports = AccountLogs;
