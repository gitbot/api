var     async = require('async')
    ,   errors = require('node-restify-errors')
    ,   responder = require('../util').responder;

exports.Session = function(redis, ttl) {
    this.redis = redis;
    this.ttl = ttl || 86400;
    var self = this;

    this.find = function(code, done) {
        redis.get('session:' + code, function(err, data) {
            if (err) {
                console.error(err);
                done(new errors.InternalError('Cannot create a new session.'));
            } else {
                var sess = data && JSON.parse(data.toString()) || { accessToken: false, username: null };
                self.touch(code, function() {});
                done(null, sess);
            }
        });
    };

    this.start = function(code, data, done)  {
        this.update(code, data, done);
    };

    this.update = function(code, data, done) {
        redis.setex('session:' + code, this.ttl, JSON.stringify(data), done);
    };

    this.touch = function(code, done) {
        redis.expire('session:' + code, this.ttl, done);
    };

    this.end = function(code, done) {
        redis.del('session:' + code, done);
    };
};

exports.User = function(redis, github) {

    this.redis = redis;
    this.github = github;

    this.findOrCreate = function(token, profile, done) {
        var userKey = 'users:' + profile.login;
        async.parallel({
            user: function upsertUser(callback) {
                redis.hmset(userKey, {
                    id: profile.id + '',
                    email: profile.email,
                    name: profile.name
                }, responder(null, function(err) {
                            callback(err, err? null: {
                                id: profile.id,
                                email: profile.email,
                                name: profile.name,
                                login: profile.login,
                                avatar_url: profile.avatar_url
                            });
                        }
                    ));
            },

            projects: function getProjects(callback) {
                redis.smembers(userKey + ':projects', responder(null, callback));
            },

            repos: function getRepos(callback) {
                redis.smembers(userKey + ':repos', responder(null, callback));
            }

        },
        responder('Cannot create user.', function(err, ret) {
            if (err) {
                done (err);
            } else {
                var user = ret.user;
                user.projects = ret.projects;
                user.repos = ret.repos;
                user.synced = (user.repos.length > 0);
                done(null, user);
            }
        }));
    };

    this.getRepos = function(token, username, done) {
        redis.smembers('users:' + username + ':repos', responder('Cannot get repos.', function(err, ret) {
            done(err, err ? null: ret);
        }));
    };

    this.sync = function(token, username, done) {
        var self = this;
        async.parallel({
            repos: function(callback) {
                console.log('Syncing repos');
                self.syncRepos(token, username, callback);
            },
            orgs: function(callback) {
                console.log('Syncing orgs');
                self.syncOrgs(token, username, callback);
            }
        },
        responder('Cannot sync user', function(err) {
            console.log('User sync complete');
            done(err, err ? null : {success: true});
        }));
    },


    this.syncRepos = function(token, username, done) {
        async.waterfall([
                function getRepos(callback) {
                    github.getRepos(token, callback);
                },
                function filter(repos, callback) {
                    async.map(repos, function(repo, cb2) {
                        cb2(null, repo.full_name);
                    }, callback);
                },
                function saveRepos(repos, callback) {
                    redis.sadd('users:' + username + ':repos', repos, callback);
                }
            ],
            responder('Cannot sync repos', function(err) {
                done(err, err ? null : {success:true});
            }));
    };

    this.saveOrgRepos = function(token, username, orgs, done)  {
        async.forEach(orgs, function(org, callback) {
            async.waterfall([
                    function getRepos(cb) {
                        github.getOrgRepos(token, org, cb);
                    },
                    function filter(repos, cb) {
                        async.map(repos, function(repo, cb2) {
                            cb2(null, repo.full_name);
                        }, cb);
                    },
                    function save(repos, cb) {
                        redis.sadd('users:' + username + ':repos',
                            repos,
                            cb);
                    }
                ], responder(null, callback));

        }, responder('Cannot save organization repos.', function(err) {
            done(err, err ? null : {success: true});
        }));
    },

    this.syncOrgs = function(token, username, done) {
        var     redis = this.redis
            ,   github = this.github
            ,   self = this;
        async.waterfall([
                function getOrgs(callback) {
                    github.getOrgs(token, callback);
                },
                function filter(orgs, callback) {
                    async.map(orgs, function(org, cb2) {
                        cb2(null, org.login);
                    }, callback);
                },
                function saveOrgs(orgs, callback) {
                    async.parallel({
                        save: function(cb2) {
                            redis.sadd('users:' + username + ':orgs', orgs, cb2);
                        },
                        saveOrgRepos: function(cb2) {
                            self.saveOrgRepos(token, username, orgs, cb2);
                        }
                    }, callback);
                }
            ], responder('Cannot sync organizations', function(err) {
                done(err, err ? null : {success: true} );
            }));
    };
};