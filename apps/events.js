var
        config = require('../lib/config')
    ,   redis = require('redis')
    ,   sub = redis.createClient(config.db.port, config.db.host);

module.exports.listen = function(app) {

    var
            conf = {origins: config.socket.origins}
        ,   userReady = ':user:ready'
        ,   userReadyPattern = '*' + userReady
        ,   projectReady = ':project:ready'
        ,   projectReadyPattern = '*' + projectReady
        ,   io = require('socket.io').listen(app, conf)
        ,   socketMap = {};

    var emit = function(channel, suffix, message) {
        var username = channel.replace(suffix, '');
        var sockets = socketMap[username];
        if (sockets) {
            for (var socket in sockets) {
                socket.volatile.emit(message);
            }
        }
    };
    
    var pubsub = function() {
        sub.on("end", function () {
            console.log('Redis disconnected.');
            sub = redis.createClient(config.db.port, config.db.host);
            pubsub();
        }).on("error", function (err) {
            console.log('Redis error.');
            console.error(err);
        }).on("connect", function() {
            console.log('Redis connected.');
            console.log('Subscribing to ' + userReady);
            sub.psubscribe('*' + userReady);
            console.log('Subscribing to ' + projectReady);
            sub.psubscribe('*' + projectReady);
        }).on("pmessage", function(pattern, channel, message) {
            console.log('Message received: channel=' + channel +
                                ',msg=' + message);
            if (pattern === userReadyPattern) {
                emit(channel, userReady, 'ready');
            } else if (pattern === projectReady) {
                emit(channel, projectReady, 'ready');
            }
        });

    };

    pubsub();

    io.sockets.on('connection', function(socket) {
        socket.on("init", function(username) {
            console.log("Got init event");
            var userSockets = socketMap[username] || [];
            userSockets.push(socket);
            socketMap[username] = userSockets;
        });
        socket.on("disconnect", function() {
            console.log("Socket disconnected");
            if (redis) {
                redis.quit();
            }
        });
    });
};