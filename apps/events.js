var    config = require('../lib/config');

module.exports.listen = function(app) {

    var     io = require('socket.io').listen(app, {origins: config.socket.origins});

    io.sockets.on('connection', function(socket) {
        var     userReady = '*:user:ready'
            ,   projectReady = '*:project:ready'
            ,   redis = require('redis').createClient(config.db.port, config.db.host);

        redis.on("error", function (err) {
            console.log('Redis error.');
            console.error(err);
        }).on("connect", function() {
            console.log('Redis connected.');
            console.log('Subscribing to ' + userReady);
            redis.psubscribe(userReady);
            console.log('Subscribing to ' + projectReady);
            redis.psubscribe(projectReady);
        });
        socket.on("init", function(username) {
            console.log("Got init event");
            redis.on("pmessage", function(pattern, channel, message) {
                console.log('Message received: channel=' + channel + ',msg=' + message);
                if (pattern === userReady &&
                    channel === userReady.replace('*', username)) {
                    socket.volatile.emit('ready');
                } else if (pattern === projectReady &&
                    channel === userReady.replace('*', username)) {
                    socket.volatile.emit('projectReady');
                }
            });
        });
        socket.on("disconnect", function() {
            console.log("Socket disconnected");
            redis.quit();
        });
    });
};