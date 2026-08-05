const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

const errorLogger = (message) => {
  const now = moment().tz("Asia/Kolkata");
  const formattedDate = now.format("YYYY-MM-DD");
  const logFileName = `error-${formattedDate}.log`;
  const logFilePath = path.join(__dirname, "logs", logFileName);

  const log = `
  Error in ${now.format()}
  Message: ${message}
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
};

module.exports = { errorLogger };
