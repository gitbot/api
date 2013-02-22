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

module.exports.Kue = function(config) {
    
    var     kue = require('kue');

    kue.redis.createClient = function() {
        return module.exports.Redis(config);
    };
    return kue;
};

module.exports.Jobs = function (config) {
    return module.exports.Kue(config).createQueue();
};