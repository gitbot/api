var    config = require('../lib/config');

module.exports.listen = function(app) {

    var     io = require('socket.io').listen(app, {origins: config.socket.origins});

    io.sockets.on('connection', function(socket) {
    socket.on("init", function(username) {
            var     userReady = username + ':ready'
                ,   redis = require('redis').createClient(config.db.port, config.db.host);
            redis
                .on("error", function (err) {
                    console.error(err);
                })
                .on("connect", function() {
                    redis.subscribe(userReady);
                })
                .on("message", function(channel, message) {
                    if (channel === userReady) {
                        socket.volatile.emit('ready');
                    }
                });
            socket.on("disconnect", function() {
                redis.quit();
            });
        });
    });
};