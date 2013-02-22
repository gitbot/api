var
        config = require('../lib/config')
    ,   factory = require('../lib/factory')
    ,   sub = factory.Redis(config);

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
            sockets.forEach(function(socket) {
                socket.emit(message);
            });
        } else {
            var pending = pendingMessages[username] || [];
            pending.push(message);
            pendingMessages[username] = pending;
        }
    };
    
    sub.psubscribe('*' + userReady);
    sub.psubscribe('*' + projectReady);
    sub.on("pmessage", function(pattern, channel, message) {
        if (pattern === userReadyPattern) {
            emit(channel, userReady, 'ready');
        } else if (pattern === projectReady) {
            emit(channel, projectReady, 'projectReady');
        }
    });
    io.sockets.on('connection', function(socket) {
        socket.on("init", function(username) {
            socket.set('username', username);
            var userSockets = socketMap[username] || [];
            userSockets.push(socket);
            socketMap[username] = userSockets;
            var pending = pendingMessages[username] || [];
            pendingMessages[username] = [];
            pending.forEach(function(message) {
                socket.emit(message);
            });
        });
        socket.on("disconnect", function() {
            socket.get('username', function(username) {
                if (username && socketMap[username]) {
                    socketMap[username].remove(socket);
                }
            });
        });
    });
};