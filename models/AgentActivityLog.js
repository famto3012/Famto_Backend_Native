const mongoose = require("mongoose");

const agentActivityLogSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    ref: "Agent",
  },
  date: {
    type: Date,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
});

const AgentActivityLog = mongoose.model(
  "AgentActivityLog",
  agentActivityLogSchema
);

module.exports = AgentActivityLog;
