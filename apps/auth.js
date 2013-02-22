module.exports = function(config, jobs) {
    
    config = config || require('../lib/config');

    var     async = require('async')
        ,   express = require('express')
        ,   factory = require('../lib/factory')
        ,   GithubAuth = require('../lib/auth/github')
        ,   githubAuth = new GithubAuth(config.auth, config.github)
        ,   GithubModel = require('../lib/model/github')
        ,   githubModel = new GithubModel(config.github)
        ,   redis = factory.Redis(config)
        ,   util = require('../lib/util')
        ,   restrict = util.restrict
        ,   responder = util.responder
        ,   Session = require('../lib/model/account').Session
        ,   session = new Session(redis)
        ,   User = require('../lib/model/account').User
        ,   user = new User(redis, githubModel)
        ,   app = express();

    jobs = jobs || factory.Jobs(config);

    var scopes = ['user', 'repo', 'repo:status'];

    function getAuthUrl(req, res) {
        githubAuth.getAuthUrl(
            scopes,
            config.site,
            responder("Cannot get authorization url for github.",
                function(err, ret) {
                    res.send(err||ret);
                }
            )
        );
    }

    function getAccessToken(req,  res) {
        var     code = req.query.code
            ,   state = req.query.state;

        async.waterfall([
                function getToken(done) {
                    githubAuth.getAccessToken(code, state, done);
                },
                function startSession(result, done) {
                    if (!result.access_token) {
                        return done('Invalid access token.');
                    }
                    session.start(code, {accessToken: result.access_token}, done);
                }
            ],
            responder("Cannot create a new session.", function(err) {
                res.send(err||{success: true, code: code});
            })
        );
    }


    function getProfile(req, res) {
        var     code = req.session.authcode
            ,   token = req.session.accessToken
            ,   username = null;
        async.waterfall([
                function getProfile(done) {
                    githubAuth.getUserProfile(token, function(err, profile) {
                        if (err) {
                            done({
                                message: "Cannot authenticate with github",
                                error: err
                            });
                        } else {
                            username = req.session.username = profile.login;
                            done(null, profile);
                        }
                    });
                },
                function findOrCreateUser(profile, done) {
                    user.findOrCreate(token, profile, function(err, user) {
                       if (err) {
                            done({
                                message: "Cannot get user profile.",
                                error: err
                            });
                        } else {
                            done(null, user);
                        }
                    });
                },
                function updateSession(user, done) {
                    session.update(code, {
                        accessToken: token,
                        username: username
                    }, function(err) {
                        if (err) {
                            done({
                                message: "Cannot update session.",
                                error: err
                            });
                        }
                        else {
                            done(null, user);
                        }
                    });
                },
                function syncUser(user, done) {
                    var job = jobs.create('user:sync', {
                        username: user.login,
                        token: token
                    }).save();
                    job.on('complete', function() {
                        redis.hset('users:' + user.login, 'synced', true);
                    });
                    done(null, user);
                }
            ],
            responder('Cannot get user profile.', function(err, ret) {
                res.send(err||ret);
            })
        );
    }

    function logout(req, res) {
        session.end(req.session.authcode, responder("Unable to log out.", function(err) {
            res.send(err||{success: true});
        }));
    }

    var routes = {
        auth: '/github',
        done: '/github/user',
        profile: '/github/profile',
        logout: '/github/logout'
    };

    app.get(routes.auth, getAuthUrl);
    app.get(routes.done, getAccessToken);

    app.get(routes.profile, restrict, getProfile);
    app.get(routes.logout, restrict, logout);
    return app;
};