var    config = require('../lib/config');

module.exports.listen = function(app) {

    var     io = require('socket.io').listen(app, {origins: config.socket.origins});

    io.sockets.on('connection', function(socket) {
    socket.on("init", function(username) {
            console.log("Got init event");
            var     userReady = username + ':ready'
                ,   projectReady = username + ':project:ready'
                ,   redis = require('redis').createClient(config.db.port, config.db.host);
            redis
                .on("error", function (err) {
                    console.log('Redis error.');
                    console.error(err);
                })
                .on("connect", function() {
                    console.log('Redis connected. Subscribing.');
                    redis.subscribe(userReady);
                    redis.subscribe(projectReady);
                })
                .on("message", function(channel, message) {
                    console.log('Message received: channel=' + channel + ',msg=' + message)
                    if (channel === userReady) {
                        socket.volatile.emit('ready');
                    } else if (channel === projectReady) {
                        socket.volatile.emit('projectReady');
                    }
                });
            socket.on("disconnect", function() {
                console.log("Socket disconnected");
                redis.quit();
            });
        });
    });
};