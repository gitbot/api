module.exports.listen = function(app, config) {

    config = config || require('../lib/config');

    var     factory = require('../lib/factory')
        ,   redis = factory.Redis(config)
        ,   sub = factory.Redis(config)
        ,   conf = {origins: config.socket.origins}
        ,   userReady = ':user:status'
        ,   userReadyPattern = '*' + userReady
        ,   projectReady = ':project:status'
        ,   projectReadyPattern = '*' + projectReady
        ,   buildStatus = ':build:status'
        ,   buildStatusPattern = '*' + buildStatus
        ,   io = require('socket.io').listen(app, conf)
        ,   users = new (require('../lib/model/account')).User(config, redis);


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


    sub.psubscribe(userReadyPattern);
    sub.psubscribe(projectReadyPattern);
    sub.psubscribe(buildStatusPattern);
    sub.on("pmessage", function(pattern, channel, message) {
        if (pattern === userReadyPattern) {
            io.sockets.in(channel.replace(userReady, '')).emit('ready');
        } else if (pattern === projectReady) {
            io.sockets.in(channel.replace(projectReady, '')).emit('projectReady');
        } else if (pattern === buildStatus) {
            io.sockets.in(channel.replace(buildStatus, '')).emit(message);
        }
    });
    io.sockets.on('connection', function(socket) {
        socket.on("init", function(username) {
            // Join the user room
            socket.join(username);

            // Get the user
            users.load(username, function(err, user) {
                if (err) {
                    console.err('Cannot load user: ' + username);
                    console.err(err);
                } else {
                    // Join all the repo rooms for this user
                    if (user.repos && user.repos.length) {
                        user.repos.forEach(function(repo) {
                            socket.join(repo);
                        });
                    }

                    if (user.synced) {
                        io.sockets.in(username).emit('ready');
                    }
                }
            });
        });
    });
};