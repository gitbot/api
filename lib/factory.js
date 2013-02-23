module.exports.Redis = function(config) {
    config = config || require('../lib/config');
    var redis = require('redis').createClient(
                    config.db.port,
                    config.db.host);
    redis.on("error", function(err) {
        console.error("Redis connection error", err);
    });
    return redis;
};