const logger = require('./index');

// Request logging middleware (replaces morgan)
const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  // Log request
  logger.info.http('HTTP Request', {
    method: req.method,
    url: req.originalUrl || req.url,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
    },
    params: req.params,
    query: req.query,
  });

  // Capture response end
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    const duration = Date.now() - startTime;
    logger.info.http('HTTP Response', {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
    return originalEnd(...args);
  };

  next();
};

module.exports = requestLogger;