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
        ,   socketMap = {}
        ,   pendingMessages = {};

    io.configure('production', function(){
        io.enable('browser client minification');  // send minified client
        io.enable('browser client etag');          // apply etag caching logic based on version number
        io.enable('browser client gzip');          // gzip the file
        io.set('log level', 1);

        io.set('transports', [
                'websocket'
            ,   'flashsocket'
            ,   'htmlfile'
            ,   'xhr-polling'
            ,   'jsonp-polling'
        ]);
    });

    io.configure('development', function(){
        io.set('transports', ['websocket']);
    });

    var emit = function(channel, suffix, message) {
        var username = channel.replace(suffix, '');
        var sockets = socketMap[username];
        if (sockets) {
            for (var socket in sockets) {
                socket.emit(message);
            }
        } else {
            var pending = pendingMessages[username] || [];
            pending.push(message);
            pendingMessages[username] = pending;
        }
    };
    
    console.log('Subscribing to ' + userReady);
    sub.psubscribe('*' + userReady);
    console.log('Subscribing to ' + projectReady);
    sub.psubscribe('*' + projectReady);
    sub.on("error", function (err) {
        console.log('Redis error.');
        console.error(err);
    }).on("pmessage", function(pattern, channel, message) {
        console.log('Message received: channel=' + channel +
                            ',msg=' + message);
        if (pattern === userReadyPattern) {
            emit(channel, userReady, 'ready');
        } else if (pattern === projectReady) {
            emit(channel, projectReady, 'ready');
        }
    });
    io.sockets.on('connection', function(socket) {
        socket.on("init", function(username) {
            console.log("Got init event");
            socket.set('username', username);
            var userSockets = socketMap[username] || [];
            userSockets.push(socket);
            socketMap[username] = userSockets;
            var pending = pendingMessages[username] || [];
            pendingMessages[username] = [];
            for (var message in pending) {
                socket.emit(message);
            }
        });
        socket.on("disconnect", function() {
            console.log("Socket disconnected");
            var username = socket.get('username');
            if (username && socketMap[username]) {
                socketMap[username].remove(socket);
            }
        });
    });
};