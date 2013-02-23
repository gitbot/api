var     async = require('async')
    ,   util = require('../util')
    ,   compose = util.compose
    ,   responder = util.responder
    ,   GithubModel = require('./github')
    ,   Builds = require('./build')
    ,   yaml = require('js-yaml');

var Component = function(data) {

    var     defaults = { command: 'all', trigger: 'push' }
        ,   item = compose(defaults, data)
        ,   actions = item.actions
        ,   self = this;

    delete item.actions;
    self.actions = [];
    actions.forEach(function(action) {
        self.actions.push(compose(item, action));
    });

    self.name = item.name;
    delete item.name;
    self.data = item;
};

exports.Project = function(config, redis) {
    this.redis = redis;
    this.config = config;
    var github = this.github = new GithubModel(config);
    this.builds = new Builds(config, redis);
    var self = this;

    this.add = function(token, username, repo, done) {
        // Add project to the global set of projects (hash=>projects)
        // Add project to the set of projects (hash=>project:users)
        // Add project to the user (hash=>user:projects)
        // Trigger work item
        async.auto({
            addProject: function addProject(callback) {
                redis.sadd('projects', repo, callback);
            },
            addUser: function addUser(callback) {
                redis.sadd('projects:' + repo + ':users', username, callback);
            },

            addGitbot: function addGitbot(callback) {
                redis.sadd('users:' + username + ':projects', repo, callback);
            }
        }, done);
    };

    this.remove = function(token, username, repo, done) {
        async.auto({
            removeProject: function removeProject(callback) {
                redis.srem('projects', repo, callback);
            },
            getUsers: function getUsers(callback) {
                redis.smembers('projects:' + repo + ':users', callback);
            },
            removeUsers: ['getUsers', function removeUsers(callback) {
                redis.del('projects:' + repo + ':users', callback);
            }],
            removeGitbot: ['getUsers', function removeGitbot(callback, res) {
                var users = res.getUsers;
                async.forEach(users, function(user, cb2) {
                    redis.srem('users:' + username + ':projects',
                        repo, cb2);
                }, callback);
            }]
        }, done);
    };

    this.findAction = function(proj, triggerEvent, triggerRepo, triggerBranch, done) {
        var hooksKey = 'projects:' + proj + ':hooks:' + triggerRepo + ':events:' + triggerEvent;

        async.waterfall([
            function getMappedActions(callback) {
                redis.smembers(hooksKey, callback);
            },
            function matchAction(actions, callback) {
                // TODO: If there are multiple builds detected, we should run them all.
                async.detectSeries(actions, function(actionMap, cb) {
                    actionMap = JSON.parse(actionMap);
                    var testRegexp = new RegExp(actionMap.branch.replace('*', '.*'));
                    cb(
                        actionMap.branch === '*' ||
                        actionMap.branch === triggerBranch ||
                        testRegexp.test(triggerBranch)
                    );
                }, function(result) {
                    if (result) {
                        callback(null, result);
                    } else {
                        callback('Cannot find the action');
                    }
                });
            },
            function getAction(actionMap, callback) {
                if (!actionMap) callback('Not found.');
                actionMap = JSON.parse(actionMap);
                redis.hgetall(actionMap.action, callback);
            }
        ], responder('Cannot find the action for trigger.', done));
    };

    this.saveComponent = function(token, username, repo, component, done) {
        var actionsKey = 'projects:' + repo + ':actions';
        var componentKey = 'projects:' + repo + ':components:' + component.name;
        var actionKeys = [];
        async.forEach(component.actions,
            function(action, callback) {
                var actionKey = componentKey + ':actions:' + action.name;
                actionKeys.push(actionKey);
                redis.hmset(actionKey, action, callback);
            }, responder(null, function(err) {
                if (err) done(err);
                else redis.sadd(actionsKey, actionKeys, done);
            }));
    };

    this.saveAuthUser = function(token, username, repo, done) {
        var authUserKey = 'projects:' + repo + ':authuser';
        redis.hmset(authUserKey, {token:token, username:username}, done);
    };

    this.getAuthUser = function(repo, done) {
        var authUserKey = 'projects:' + repo + ':authuser';
        redis.hgetall(authUserKey, done);
    };

    this.cleanAuthUser = function(repo, done) {
        var authUserKey = 'projects:' + repo + ':authuser';
        redis.del(authUserKey, done);
    };

    this.addHooks = function(token, username, repo, components, done) {
        var     projectKey = 'projects:' + repo
            ,   projectHookKey = 'projects:' + repo + ':synchook'
            ,   projectHooksKey =  projectKey + ':hooks'
            ,   projectHookActionsKey =  projectKey + ':hookActions'
            ,   actionKey = projectKey + ':components:{component}:actions:{action}'
            ,   hookActionsKey = projectHooksKey + ':{repo}:events:{event}'
            ,   hookActions = {}
            ,   hookIds = {};

        components.forEach(function(component) {
            component.actions.forEach(function(action) {
                var hookActionKey = hookActionsKey
                                        .replace('{repo}', action.repo)
                                        .replace('{event}', action.trigger);
                var thisActionKey = actionKey
                                        .replace('{component}', component.name)
                                        .replace('{action}', action.name);
                var actions = hookActions[hookActionKey] || (hookActions[hookActionKey] = []);
                actions.push(JSON.stringify({branch: action.branch, action:thisActionKey}));
                hookIds[action.repo + ':::' + action.trigger] = null;
            });
        });

        async.auto({
            saveActions: function saveActions(callback) {
                async.forEach(Object.keys(hookActions), function (hookActionKey, cb) {
                    redis.sadd(hookActionKey, hookActions[hookActionKey], cb);
                }, callback);
            },

            saveHookActions: function saveHookActions(callback) {
                redis.sadd(projectHookActionsKey, Object.keys(hookActions), callback);
            },

            addProjectHook: function addProjectHook(callback) {
                github.addHook(token, 'gb-sync-project', repo, 'push', callback);
            },

            saveProjectHook: ['addProjectHook', function(callback, res) {
                var data = res.addProjectHook;
                redis.set(projectHookKey, data.id, callback);
            }],

            hookGithub: function(callback) {
                async.forEach(Object.keys(hookIds), function(hookKey, cb2) {
                    var     parts = hookKey.split(':::')
                        ,   arepo = parts[0]
                        ,   aevent = parts[1];

                    github.addHook(token, repo, arepo, aevent, function(err, data) {
                        if (err) cb2(err);
                        else {
                            hookIds[hookKey] = {
                                repo: arepo,
                                id: data.id
                            };
                            cb2(null, data.id);
                        }

                    });
                }, callback);
            },

            saveHooks: ['hookGithub', function(callback) {
                var hookIdList = [];

                for (var key in hookIds) {
                    var value = hookIds[key];
                    if (value) {
                        hookIdList.push(JSON.stringify(value));
                    }
                }
                if (hookIdList.length) {
                    redis.sadd(projectHooksKey, hookIdList, callback);
                } else {
                    callback(null, {success: true});
                }
            }]}, done
        );
    };

    this.cleanActions = function(token, username, repo, done) {
        var actionsKey = 'projects:' + repo + ':actions';
        async.waterfall([

            function fetchActions(callback) {
                redis.smembers(actionsKey, callback);
            },

            function cleanup(actions, callback) {
                var keys = actions;
                keys.push(actionsKey);
                redis.del(keys, callback);
            }
        ], done);
    };

    this.cleanHooks = function(token, username, repo, done) {
        var hooksKey = 'projects:' + repo + ':hooks';
        var hookActionsKey = 'projects:' + repo + ':hookActions';
        var projectHookKey = 'projects:' + repo + ':synchook';
        async.auto({

            fetchProjectHook: function fetchProjectHook(callback) {
                redis.get(projectHookKey, callback);
            },

            fetchHooks: function fetchHooks(callback) {
                redis.smembers(hooksKey, callback);
            },

            fetchHookActions: function fetchHooks(callback) {
                redis.smembers(hookActionsKey, callback);
            },

            cleanDbProjectHook: ["fetchProjectHook", function(callback) {
                redis.del(projectHookKey, callback);
            }],

            cleanDb: ["fetchHooks", function cleandb(callback) {
                redis.del(hooksKey, callback);
            }],

            cleanDbHookActions: ["fetchHookActions", function(callback, res) {
                async.forEach(res.fetchHookActions, function(hookActionKey, cb2) {
                    redis.del(hookActionKey, cb2);
                }, function (err, res) {
                    if (err) {
                        callback(err, res);
                    } else {
                        redis.del(hookActionsKey, callback);
                    }
                });
            }],

            cleanProjectHook: ["fetchProjectHook",
                function cleanProjectHook(callback, res) {
                    if (res.fetchProjectHook) {
                        github.removeHook(token, repo, res.fetchProjectHook, callback);
                    } else {
                        callback(null, {success: true});
                    }
                }
            ],

            cleanGithub: ["fetchHooks", function(callback, res) {
                var hooks = res.fetchHooks;
                if (hooks) {
                    async.forEach(hooks, function(hook, cb2) {
                        var hookObj = JSON.parse(hook);
                        github.removeHook(token, hookObj.repo, hookObj.id, cb2);
                    }, callback);
                } else {
                    callback(null, {success: true});
                }
            }]

        },  responder('Unable to clean project hooks.', function(err) {
                done(err, err ? null : {success: true} );
            }
        ));
    };

    this.parse = function(yamlText) {
        var components = [];
        var data = yaml.load(yamlText);
        data.components.forEach(function (component) {
            components.push(new Component(component));
        });
        return components;
    };

    this.clean = function(token, username, repo, done) {
        var self = this;
        async.auto({
            wipeHooks: function cleanHooks(callback) {
                self.cleanHooks(token, username, repo, callback);
            },

            wipeActions: function cleanActions(callback) {
                self.cleanActions(token, username, repo, callback);
            },

            wipeAuthUser: ["wipeHooks", function cleanAuthUser(callback) {
                self.cleanAuthUser(repo, callback);
            }]
        }, done);
    };

    this.trigger = function(proj, repo, branch, sha, event, done)  {
        var self = this;
        async.waterfall([

            function findAction(done) {
                self.findAction(proj, event, repo, branch, done);
            },

            function getAuthUser(action, done) {
                if (!action) {
                    return done('Cannot find an action for the received hook.');
                }
                self.getAuthUser(proj, function(err, result) {
                    if (err) done(err);
                    else {
                        done (null, result, action);
                    }
                });
            },

            function triggerAction(authUser, action, done) {
                var trigger = {
                    project: proj,
                    repo: repo,
                    branch: branch,
                    sha: sha,
                    event: event
                };
                self.builds.create(authUser, trigger, action, done);
            }
        ], done);
    },

    this.autoSync = function(repo, done) {
        var self = this;
        async.waterfall([
                function getAuthUser(callback) {
                    self.getAuthUser(repo, callback);
                },
                function sync(authuser, callback) {
                    self.sync(authuser.token, authuser.username, repo, callback);
                }
            ],
            responder('Unable to autosync project', function(err) {
                done(err, err ? null : {success: true} );
            }
        ));
    },

    this.sync = function(token, username, repo, done) {
        var self = this;
        async.auto({

            clean: function(callback) {
                self.clean(token, username, repo, callback);
            },

            fetchConfig: function fetchConfig(callback) {
                github.fetchConfig(token, repo, function(err, res) {
                    if (err) callback(err);
                    else callback(null, self.parse(res));
                });
            },

            persist: ["clean", "fetchConfig", function persist(callback, res) {
                var components = res.fetchConfig;
                async.forEach(components,
                    function(component, cb2) {
                        self.saveComponent(token, username, repo, component, cb2);
                    },
                    function(err) {
                        callback(err, components);
                    }
                );
            }],

            addHooks: ["clean", "fetchConfig", function addHooks(callback, res) {
                self.addHooks(token, username, repo, res.fetchConfig, callback);
            }],

            saveToken: ["addHooks", function cacheToken(callback) {
                self.saveAuthUser(token, username, repo, callback);
            }]
        }, responder('Unable to sync components.', function(err) {
            done(err, err ? null : {success: true} );
        }));
    };
};