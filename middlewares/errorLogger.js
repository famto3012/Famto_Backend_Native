const logger = require('../utils/logger');

/**
 * Unified error logger using Pino with rotating file streams
 * Logs are stored in logs/errors/ directory with daily rotation and 14-day retention
 */

const errorLogger = (message, extra = {}, category = 'general') => {
  const errorInfo = {
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  logger.error[category](message, errorInfo);
  return errorInfo;
};

module.exports = { errorLogger };