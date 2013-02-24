var     async = require('async')
    ,   errors = require('../node-restify-errors')
    ,   GithubModel = require('./github')
    ,   responder = require('../util').responder;

exports.Session = function(redis, ttl) {
    this.redis = redis;
    this.ttl = ttl || 86400;
    var self = this;

    this.find = function(code, done) {
        self.redis.get('session:' + code, function(err, data) {
            if (err) {
                console.error(err);
                done(new errors.InternalError('Cannot create a new session.'));
            } else {
                var sess = data && JSON.parse(data.toString()) ||
                            { accessToken: false, username: null };
                self.touch(code, function() {});
                done(null, sess);
            }
        });
    };

    this.start = function(code, data, done)  {
        self.update(code, data, done);
    };

    this.update = function(code, data, done) {
        self.redis.setex('session:' + code, this.ttl, JSON.stringify(data), done);
    };

    this.touch = function(code, done) {
        self.redis.expire('session:' + code, this.ttl, done);
    };

    this.end = function(code, done) {
        self.redis.del('session:' + code, done);
    };
};

exports.User = function(config, redis) {

    this.redis = redis;
    this.config = config;
    this.github = new GithubModel(config);
    var self = this;

    this.findOrCreate = function(token, profile, done) {
        var userKey = 'users:' + profile.login;
        async.parallel({
            user: function upsertUser(callback) {
                self.redis.hmset(userKey, {
                    id: profile.id + '',
                    email: profile.email || '',
                    name: profile.name || ''
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

            synced: function getSynced(callback) {
                self.redis.hget(userKey, 'synced', callback);
            },

            projects: function getProjects(callback) {
                self.redis.smembers(userKey + ':projects', callback);
            },

            repos: function getRepos(callback) {
                self.redis.smembers(userKey + ':repos', callback);
            }

        },
        responder('Cannot create user.', function(err, ret) {
            if (err) {
                done (err);
            } else {
                var user = ret.user;
                user.synced =  ret.synced? true: false;
                user.projects = ret.projects;
                user.repos = ret.repos;
                done(null, user);
            }
        }));
    };

    this.load = function (username, done) {
        var userKey = 'users:' + username;
        async.auto({

            user: function getUser(callback) {
                self.redis.hgetall(userKey, callback);
            },

            repos: ['user', function(callback) {
                self.redis.smembers(userKey + ':repos', callback);
            }],

            projects: ['user', function(callback) {
                self.redis.smembers(userKey + ':projects', callback);
            }]
        }, responder('Cannot load user.', function(err, ret) {
            if (err) {
                done (err);
            } else {
                var user = ret.user;
                user.synced =  ret.user.synced? true: false;
                user.projects = ret.projects;
                user.repos = ret.repos;
                done(null, user);
            }
        }));
    };

    this.getRepos = function(token, username, done) {
        self.redis.smembers('users:' + username + ':repos',
            responder('Cannot get repos.', function(err, ret) {
            done(err, err ? null: ret);
        }));
    };

    this.getProjects = function(token, username, done) {
        self.redis.smembers('users:' + username + ':projects',
            responder('Cannot get projects.', function(err, ret) {
            done(err, err ? null: ret);
        }));
    };

    this.sync = function(token, username, done) {
        async.auto({
            repos: function(callback) {
                self.syncRepos(token, username, callback);
            },
            orgs: function(callback) {
                self.syncOrgs(token, username, callback);
            },
            projects: ['repos', 'orgs', function(callback) {
                self.syncProjects(token, username, callback);
            }],
            flag: ['projects', function(callback) {
                self.redis.hset('users:' + username, 'synced',
                    'true',
                    callback);
            }]
        },
        responder('Cannot sync user', function(err) {
            done(err, err ? null : {success: true});
        }));
    };

    this.syncProjects = function(token, username, done) {
        var     userProjectsKey = 'users:' + username + ':projects'
            ,   projectsKey = 'projects'
            ,   userReposKey = 'users:' + username + ':repos';

        self.redis.sinterstore(
            userProjectsKey,
            projectsKey,
            userReposKey,
            done);
    };


    this.syncRepos = function(token, username, done) {
        async.waterfall([
                function getRepos(callback) {
                    self.github.getRepos(token, callback);
                },
                function filter(repos, callback) {
                    async.map(repos, function(repo, cb2) {
                        cb2(null, repo.full_name);
                    }, callback);
                },
                function saveRepos(repos, callback) {
                    if (repos.length) {
                        self.redis.sadd('users:' + username + ':repos',
                                repos, callback);
                    } else {
                        callback(null);
                    }
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
                        self.github.getOrgRepos(token, org, cb);
                    },
                    function filter(repos, cb) {
                        async.map(repos, function(repo, cb2) {
                            cb2(null, repo.full_name);
                        }, cb);
                    },
                    function save(repos, cb) {
                        if (repos.length) {
                            self.redis.sadd('users:' + username + ':repos',
                                repos,
                                cb);
                        } else {
                            cb(null);
                        }
                    }
                ], responder(null, callback));

        }, responder('Cannot save organization repos.', function(err) {
            done(err, err ? null : {success: true});
        }));
    },

    this.syncOrgs = function(token, username, done) {
        async.waterfall([
                function getOrgs(callback) {
                    self.github.getOrgs(token, callback);
                },
                function filter(orgs, callback) {
                    async.map(orgs, function(org, cb2) {
                        cb2(null, org.login);
                    }, callback);
                },
                function saveOrgs(orgs, callback) {
                    async.parallel({
                        save: function(cb2) {
                            self.redis.sadd(
                                'users:' + username + ':orgs', orgs, cb2);
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