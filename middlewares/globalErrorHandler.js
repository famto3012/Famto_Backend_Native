const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

const globalErrorHandler = (err, req, res, next) => {
  const message = err.message || "Internal Server Error";
  const status = err.status || "Failed";
  const statusCode = err.statusCode || 500;
  const stack = err.stack;

  // Skip logging for specific errors
  if (message !== "Invalid / Expired token") {
    const now = moment().tz("Asia/Kolkata");
    const formattedDate = now.format("YYYY-MM-DD");
    const logFileName = `error-${formattedDate}.log`;
    const logFilePath = path.join(__dirname, "logs", logFileName);

    const log = `
[${now.format()}] // ISO format in IST
Status: ${status}
StatusCode: ${statusCode}
Message: ${message}
Stack: ${stack}
URL: ${req.originalUrl}
Method: ${req.method}
IP: ${req.ip}
--------------------------------------------------------
`;

    fs.mkdir(path.dirname(logFilePath), { recursive: true }, (dirErr) => {
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
  }

  // Response
  res.status(statusCode).json({ status, message, stack });
};

module.exports = globalErrorHandler;
