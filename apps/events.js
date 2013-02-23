module.exports.listen = function(app, config) {

    config = config || require('../lib/config');

    var     factory = require('../lib/factory')
        ,   sub = factory.Redis(config)
        ,   conf = {origins: config.socket.origins}
        ,   userReady = ':user:ready'
        ,   userReadyPattern = '*' + userReady
        ,   projectReady = ':project:ready'
        ,   projectReadyPattern = '*' + projectReady
        ,   buildStatus = ':build:status'
        ,   buildStatusPattern = '*' + buildStatus
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
            sockets.forEach(function(socket) {
                socket.emit(message);
            });
        } else {
            var pending = pendingMessages[username] || (pendingMessages[username] = []);
            pending.push(message);
        }
    };

    sub.psubscribe(userReadyPattern);
    sub.psubscribe(projectReadyPattern);
    sub.psubscribe(buildStatusPattern);
    sub.on("pmessage", function(pattern, channel, message) {
        if (pattern === userReadyPattern) {
            emit(channel, userReady, 'ready');
        } else if (pattern === projectReady) {
            // TODO: Use channels to subscribe and publish
            // messages per project.
            emit(channel, projectReady, 'projectReady');
        } else if (pattern === buildStatus) {
            emit(channel, buildStatus, message);
        }
    });
    io.sockets.on('connection', function(socket) {
        socket.on("init", function(username) {
            var userSockets = socketMap[username] || [];
            userSockets.push(socket);
            socketMap[username] = userSockets;
            var pending = pendingMessages[username] || [];
            pendingMessages[username] = [];
            pending.forEach(function(message) {
                socket.emit(message);
            });
            socket.on("disconnect", function() {
                var index = userSockets.indexOf(socket);
                if (index >= 0) {
                    delete userSockets[index];
                }
            });
        });
    });
};