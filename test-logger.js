const logger = require('./utils/logger');

console.log('Testing logger...\n');

// Test 1: General error logging
console.log('1. Testing general error logging...');
logger.error.general('Test error message', { userId: 123, action: 'login' });

// Test 2: WhatsApp category
console.log('2. Testing WhatsApp error logging...');
logger.error.whatsapp('WhatsApp API failed', { 
  waId: '919999999999', 
  error: 'timeout' 
});

// Test 3: Info logging
console.log('3. Testing info logging...');
logger.info.general('Test info message', { test: true, data: { key: 'value' } });

// Test 4: API category
console.log('4. Testing API error logging...');
logger.error.api('API rate limit exceeded', { 
  endpoint: '/api/v1/orders', 
  rateLimit: 100 
});

// Test 5: Database category
console.log('5. Testing database error logging...');
logger.error.database('MongoDB connection timeout', { 
  host: process.env.MONGODB_HOST || 'localhost',
  retryCount: 3 
});

// Test 6: logError helper method
console.log('6. Testing logError helper...');
const error = new Error('Test error for helper method');
error.code = 'TEST_ERROR';
logger.logError(error, { context: 'user authentication' });

console.log('\nTest completed. Check logs/ directory for output files.');