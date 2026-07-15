const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

const logDir = path.join(__dirname, "..", "middlewares", "logs");

const logError = (message, extra = {}) => {
  const now = moment().tz("Asia/Kolkata");
  const logFileName = `error-${now.format("YYYY-MM-DD")}.log`;
  const logFilePath = path.join(logDir, logFileName);

  const log = `
[${now.format()}] // ISO format in IST
Source: ${extra.source || "Unknown"}
Message: ${message}
${extra.stack ? `Stack: ${extra.stack}\n` : ""}${extra.orderId ? `OrderId: ${extra.orderId}\n` : ""}${extra.razorpayOrderId ? `RazorpayOrderId: ${extra.razorpayOrderId}\n` : ""}${extra.retryCount !== undefined ? `RetryCount: ${extra.retryCount}\n` : ""}--------------------------------------------------------
`;

  fs.mkdir(logDir, { recursive: true }, (dirErr) => {
    if (dirErr) {
      console.error("Could not create logs directory:", dirErr);
    } else {
      fs.appendFile(logFilePath, log, (fileErr) => {
        if (fileErr) {
          console.error("Failed to write error to file:", fileErr);
        }
      });
    }
  });
};

module.exports = { logError };
