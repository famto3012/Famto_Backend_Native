const pino = require('pino');
const { createStream } = require('rotating-file-stream');

// Ensure log directories exist
const fs = require('fs');
const path = require('path');

const logDirs = [
  'logs/errors',
  'logs/whatsapp/errors',
  'logs/whatsapp/info',
  'logs/whatsapp/messages',
  'logs/razorpay/errors',
  'logs/razorpay/info',
  'logs/cron/errors',
  'logs/cron/info',
  'logs/database/errors',
  'logs/database/info',
  'logs/http/errors',
  'logs/http/info',
  'logs/redis/errors',
  'logs/redis/info',
  'logs/api/errors',
  'logs/api/info',
];

logDirs.forEach((dir) => {
  const fullPath = path.join(__dirname, '../../', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Determine log level based on environment
const logLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

// Create rotating file stream for error logs
const createErrorStream = (category) => {
  const logPath = `logs/${category}/errors/error.log`;
  return createStream(
    (time, index) => {
      if (!time) return logPath;
      return `${logPath}.${index}`;
    },
    {
      size: '100M',
      interval: '1d',
      compress: 'gzip',
      maxFiles: 14,
    }
  );
};

// Create rotating file stream for info logs
const createInfoStream = (category) => {
  const logPath = `logs/${category}/info/info.log`;
  return createStream(
    (time, index) => {
      if (!time) return logPath;
      return `${logPath}.${index}`;
    },
    {
      size: '100M',
      interval: '1d',
      compress: 'gzip',
      maxFiles: 14,
    }
  );
};

// Store created loggers to reuse them
const loggerCache = {};

// Create logger instance with custom settings
const createLogger = (category) => {
  // Return cached logger if exists
  if (loggerCache[category]) {
    return loggerCache[category];
  }

  const errorStream = createErrorStream(category);
  const infoStream = createInfoStream(category);

  const errorLogger = pino(
    {
      level: logLevel,
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      base: {
        app: 'Famto_Backend',
        env: process.env.NODE_ENV || 'development',
        category,
      },
    },
    errorStream
  );

  const infoLogger = pino(
    {
      level: logLevel,
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      base: {
        app: 'Famto_Backend',
        env: process.env.NODE_ENV || 'development',
        category,
      },
    },
    infoStream
  );

  const loggerInstance = {
    error: (msg, data) => errorLogger.error({ ...data, msg }),
    warn: (msg, data) => infoLogger.warn({ ...data, msg }),
    info: (msg, data) => infoLogger.info({ ...data, msg }),
    debug: (msg, data) => {
      if (process.env.NODE_ENV !== 'production') {
        infoLogger.debug({ ...data, msg });
      }
    },
  };

  // Cache for reuse
  loggerCache[category] = loggerInstance;

  return loggerInstance;
};

// Create category-specific loggers
const logger = {
  // General errors (main error logger)
  error: {
    general: (msg, data) =>
      createLogger('general').error(msg, { ...data, type: 'GENERAL' }),
    whatsapp: (msg, data) =>
      createLogger('whatsapp').error(msg, { ...data, type: 'WHATSAPP' }),
    razorpay: (msg, data) =>
      createLogger('razorpay').error(msg, { ...data, type: 'RAZORPAY' }),
    cron: (msg, data) =>
      createLogger('cron').error(msg, { ...data, type: 'CRON' }),
    database: (msg, data) =>
      createLogger('database').error(msg, { ...data, type: 'DATABASE' }),
    http: (msg, data) =>
      createLogger('http').error(msg, { ...data, type: 'HTTP' }),
    redis: (msg, data) =>
      createLogger('redis').error(msg, { ...data, type: 'REDIS' }),
    api: (msg, data) =>
      createLogger('api').error(msg, { ...data, type: 'API' }),
  },

  // Info logs
  info: {
    general: (msg, data) =>
      createLogger('general').info(msg, { ...data, type: 'GENERAL' }),
    whatsapp: (msg, data) =>
      createLogger('whatsapp').info(msg, { ...data, type: 'WHATSAPP' }),
    razorpay: (msg, data) =>
      createLogger('razorpay').info(msg, { ...data, type: 'RAZORPAY' }),
    cron: (msg, data) =>
      createLogger('cron').info(msg, { ...data, type: 'CRON' }),
    database: (msg, data) =>
      createLogger('database').info(msg, { ...data, type: 'DATABASE' }),
    http: (msg, data) =>
      createLogger('http').info(msg, { ...data, type: 'HTTP' }),
    redis: (msg, data) =>
      createLogger('redis').info(msg, { ...data, type: 'REDIS' }),
    api: (msg, data) =>
      createLogger('api').info(msg, { ...data, type: 'API' }),
  },

  // Helper methods
  logError: (error, context = {}, category = 'general') => {
    const errorInfo = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      ...context,
    };

    logger.error[category](error.message, errorInfo);
    return {
      success: false,
      error: {
        message: error.message || 'An error occurred',
        code: error.code || 'INTERNAL_ERROR',
      },
    };
  },

  logWarning: (message, context = {}, category = 'general') => {
    logger.warn[category](message, context);
  },

  logInfo: (message, context = {}, category = 'general') => {
    logger.info[category](message, context);
  },

  logDebug: (message, context = {}, category = 'general') => {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug[category](message, context);
    }
  },

  logHttp: (req, res, duration) => {
    logger.info.http('HTTP Request', {
      method: req.method,
      url: req.originalUrl || req.url,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
      },
      params: req.params,
      query: req.query,
      body: req.body,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  },

  // Category accessors
  get whatsapp() {
    return {
      error: (msg, data) => createLogger('whatsapp').error(msg, data),
      info: (msg, data) => createLogger('whatsapp').info(msg, data),
    };
  },

  get razorpay() {
    return {
      error: (msg, data) => createLogger('razorpay').error(msg, data),
      info: (msg, data) => createLogger('razorpay').info(msg, data),
    };
  },

  get cron() {
    return {
      error: (msg, data) => createLogger('cron').error(msg, data),
      info: (msg, data) => createLogger('cron').info(msg, data),
    };
  },

  get database() {
    return {
      error: (msg, data) => createLogger('database').error(msg, data),
      info: (msg, data) => createLogger('database').info(msg, data),
    };
  },

  get http() {
    return {
      error: (msg, data) => createLogger('http').error(msg, data),
      info: (msg, data) => createLogger('http').info(msg, data),
    };
  },

  get redis() {
    return {
      error: (msg, data) => createLogger('redis').error(msg, data),
      info: (msg, data) => createLogger('redis').info(msg, data),
    };
  },

  get api() {
    return {
      error: (msg, data) => createLogger('api').error(msg, data),
      info: (msg, data) => createLogger('api').info(msg, data),
    };
  },
};

module.exports = logger;