const redis = require('redis');

const client = redis.createClient('redis://adm:chcsys4:@cache.mutevazipeynircilik.com:6379', {
  retry_strategy: (options) => {
    if (options.error?.code === 'ECONNREFUSED') {
      return new Error('The server refused the connection');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Retry time exhausted');
    }
    if (options.attempt > 10) return undefined;
    return Math.min(options.attempt * 100, 3000);
  }
});


client.on('error', (err) => {
  console.error('Redis Client Error', err);
});

client.on('connect', () => {
  console.log('Connected to Redis successfully');
});

// Session store configuration
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const sessionStore = new RedisStore({
  client: client,
  prefix: 'ayhon_session:',
  ttl: 86400 // 24 hours
});

module.exports = {
  client,
  sessionStore,
  redisConfig
};