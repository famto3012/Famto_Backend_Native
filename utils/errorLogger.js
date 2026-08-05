const logger = require('./logger');

/**
 * Unified error logger using Pino with rotating file streams
 * Logs are stored in logs/errors/ and logs/whatsapp/errors/ directories
 * with daily rotation and 14-day retention
 */

const logError = (message, extra = {}, category = 'general') => {
  const errorInfo = {
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  logger.error[category](message, errorInfo);
  return errorInfo;
};

const logCampaignEvent = (eventType, message, extra = {}) => {
  const errorInfo = {
    event: eventType,
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  };

  logger.error.whatsapp(message, errorInfo);
  return errorInfo;
};

module.exports = { logError, logCampaignEvent };
