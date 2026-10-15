const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
    console.error('Error de Redis:', err);
});

module.exports = redisClient;