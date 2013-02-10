var     async = require('async')
    ,   compose = require('../util').compose
    ,   util = require('../util')
    ,   responder = util.responder
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

exports.Project = function(redis, github) {
    this.redis = redis;
    this.github = github;

    this.add = function(token, username, repo, done) {
        // Add project to the set of projects (hash=>project:users)
        // Add project to the user (hash=>user:projects)
        // Trigger work item
        var projectHookKey = 'projects:' + repo + ':synchook';
        async.auto({
            addUser: function addUser(callback) {
                redis.sadd('projects:' + repo + ':users', username, callback);
            },
            
            addGitbot: function addGitbot(callback) {
                redis.sadd('users:' + username + ':projects', repo, callback);
            },
            
            addGithubHook: function addGithubHook(callback) {
                github.addHook(token, 'gb-sync-project', repo, 'push', callback);
            },

            saveProjectHook: ['addGithubHook', function(callback, data) {
                redis.set(projectHookKey, data.id, callback);
            }]
        }, done);
    };

    this.remove = function(token, username, repo, done) {
        async.parallel({
            removeUser: function removeUser(callback) {
                redis.srem('projects:' + repo + ':users', username, callback);
            },
            removeGitbot: function removeGitbot(callback) {
                redis.srem('users:' + username + ':projects', repo, callback);
            }
        }, done);
    };

    this.findAction = function(proj, triggerEvent, triggerRepo, triggerBranch, done) {
        var hooksKey = 'projects:' + proj + ':hooks:' + triggerRepo + ':events:' + triggerEvent;

        async.waterfall([
            function getMappedActions(callback) {
                redis.smembers(hooksKey, callback);
            },
            function matchAction(actions, callback) {
                async.detectSeries(actions, function(actionMap, cb) {
                    actionMap = JSON.parse(actionMap);
                    cb(
                        actionMap.branch === '*' ||
                        actionMap.branch === triggerBranch ||
                        new RegExp(actionMap.branch.replace('*', '.*')).test(triggerBranch)
                    );
                }, callback);
            },
            function getAction(actionMap, callback) {
                if (!actionMap) callback('Not found.');
                actionMap = JSON.parse(actionMap);
                redis.hmget(actionMap.action, callback);
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
                redis.hmset(actionKey, action, callback);
                actionKeys.push(actionKey);
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
        redis.hmget(authUserKey, done);
    };

    this.addHooks = function(token, username, repo, components, done) {
        var     projectKey = 'projects:' + repo
            ,   projectHooksKey =  projectKey + ':hooks'
            ,   actionKey = projectKey + ':component:{component}:action:{action}'
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
            saveActions: function(callback) {
                async.forEach(Object.keys(hookActions), function (hookActionKey, cb) {
                    redis.sadd(hookActionKey, hookActions[hookActionKey], cb);
                }, callback);
            },
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
        var projectHookKey = 'projects:' + repo + ':synchook';
        async.auto({

            fetchProjectHook: function fetchProjectHook(callback) {
                redis.get(projectHookKey, callback);
            },

            fechHooks: function fetchHooks(callback) {
              redis.smembers(hooksKey, callback);
            },

            cleanDb: ["fetchHooks", function cleandb(callback) {
                redis.del(hooksKey, callback);
            }],

            cleanProjectHook: ["fetchProjectHook",
                function cleanProjectHook(callback, hook) {
                    github.removeHook(token, repo, hook, callback);
                }
            ],

            cleanGithub: ["fetchHooks", function(callback, hooks) {
                async.forEach(hooks, function(hook, cb2) {
                    var hookObj = JSON.parse(hook);
                    github.removeHook(token, hookObj.repo, hookObj.id, cb2);
                }, callback);

            }]
        }, done);
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
        async.parallel({
            wipeHooks: function cleanHooks(callback) {
                self.cleanHooks(token, username, repo, callback);
            },

            wipeActions: function cleanActions(callback) {
                self.cleanActions(token, username, repo, callback);
            }
        }, done);
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

            persist: ["fetchConfig", function persist(callback, res) {
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

            addHooks: ["fetchConfig", function addHooks(callback, res) {
                self.addHooks(token, username, repo, res.fetchConfig, callback);
            }],
            saveToken: ["addHooks", function cacheTOken(callback) {
                self.saveAuthUser(token, username, repo, callback);
            }]
        }, responder('Unable to sync components.', function(err) {
            done(err, err ? null : {success: true} );
        }));
    };
};