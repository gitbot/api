var     async = require('async')
    ,   aws = require('aws-sdk')
    ,   util = require('../util')
    ,   GithubModel = require('./github')
    ,   responder = util.responder
    ,   hashId = util.hashId;


var Builds = module.exports = function(config, redis)  {

    this.redis = redis;
    this.config = config;
    this.githubModel = new GithubModel(config);

    this.create = function(authUser, trigger, action, done) {
        var     self = this
            ,   status = 'queued';
        async.auto({

             make: function(callback) {
                var build = JSON.parse(JSON.stringify(trigger));
                build.created = Date.now().valueOf().toString();
                build.status = status;
                build.id = hashId(build);
                build.action = action;
                build.authUser = authUser;
                callback(null, build);
            },

            save: ["make", function(callback, res) {
                var data = JSON.parse(JSON.stringify(res.make));
                data.authUser = JSON.stringify(res.make.authUser);
                data.action = JSON.stringify(res.make.action);
                data.source = JSON.stringify(res.make.source);
                redis.multi()
                .hmset('builds:' + data.id, data)
                .rpush('projects:' + data.project + ':builds', data.id)
                .rpush(status + ':builds', data.id)
                .exec(function(err, data) {
                    if (err) {
                        callback(err, data);
                    } else {
                        callback(null, res.make);
                    }
                });
            }],

            send: ["make", function(callback, res) {
                var data = JSON.parse(JSON.stringify(res.make));
                delete data.authUser;
                var url = config.statusReceiver.replace('{jobId}', data.id);
                data.status_url = url;
                data.github_oauth = authUser.token;
                aws.config.update({
                    accessKeyId: config.worker.managerKey,
                    secretAccessKey: config.worker.managerSecret,
                    region: config.worker.region
                });
                var sqs = new aws.SQS();
                var body = JSON.stringify(data);
                body = new Buffer(body).toString('base64');

                sqs.client.sendMessage({
                    QueueUrl: config.worker.queueUrl,
                    MessageBody: body
                },  function(err, response) {
                    if (err) {
                        done(err);
                    } else {
                        console.log(
                            'New action triggered with job id:' + res.make.id);
                        res.make.sqsMessageId = response.MessageId;
                        callback(null, res.make);
                    }
                });
            }],

            github: ["send", function(callback, res) {
                var sha = res.send.sha;
                if (res.send.event === 'pull_request') {
                    sha = res.send.source.sha;
                }
                self._setCommitStatus(res.send.id, authUser.token,
                    res.send.repo, sha,
                    'queued',
                    null,
                    callback);
            }],

            update: ["save", "send", function(callback, res) {
                redis.hset('builds:' + res.send.id,
                    'sqsMessageId', res.send.sqsMessageId, function(err, res) {
                        if (err) {
                            callback(err, res);
                        } else {
                            callback(null, res.send);
                        }
                    });
            }],

            log: ["save", "send", function(callback, res) {
                self._updateLog(res.send.id, status, '', callback);
            }]

        }, responder('Unable to create a new build', function(err, res) {
            if (err) {
                done(err, res);
            } else {
                done(null, res.update);
            }
        }));

    };

    this._updateLog = function(buildId, status, message, multiOrDone) {

        var data = {
            buildId: buildId,
            status: status,
            message: message,
            created: Date.now().valueOf().toString()
        };

        data.id = hashId(data);

        var     logsKey = 'builds:' + buildId + ':logs'
            ,   logKey = 'builds:' + buildId + ':logs:' + data.id;

        var multi = multiOrDone.rpush? multiOrDone : redis.multi();
        multi.rpush(logsKey, logKey);
        multi.hmset(logKey, data);
        if (!multiOrDone.rpush) {
            multi.exec(multiOrDone);
        }
    };

    this._setCommitStatus = function(buildId, token, repo,
                                    sha, status, url, done) {

        var     description =  config.messages[status]
            ,   state = config.statusMap[status];

        description = description.replace('{buildId}', buildId);

        this.githubModel.setStatus(token, repo, sha, {
            state: state,
            description: description,
            target_url: url || null
        }, done);
    },

    this.status = function(buildId, status, message, url, done) {

        var     self = this
            ,   buildKey = 'builds:' + buildId
            ,   currentStatusKey = status + ':builds';

        async.auto({

            get: function(callback) {
                redis.hgetall(buildKey, function(err, data) {
                    if (err) callback(err);
                    else {
                        data.action = JSON.parse(data.action);
                        data.authUser = JSON.parse(data.authUser);
                        data.source = JSON.parse(data.source);
                        callback(null, data);
                    }
                });
            },

            save: ['get', function(callback, res) {

                if (res.get.status === status) {

                    // If the status has not changed
                    // Just Update the log

                    self._updateLog(buildId, status, message, callback);

                } else {

                    // If it has changed

                    var     oldStatusKey = res.get.status + ':builds'
                        ,   multi = redis.multi();

                    multi

                        // Update the object
                        .hset(buildKey, 'status', status)

                        // Update the queues
                        .lrem(oldStatusKey, 0, buildId)
                        .rpush(currentStatusKey, buildId);

                    self._updateLog(buildId, status, message, multi);

                    multi.exec(callback);
                }
            }],

            github: ["get", function(callback, res) {

                if (res.get.status === status) {

                    // If the status has not changed
                    callback(null, {success: true});

                } else {

                    // If the status has changed
                    // Call github
                    var     sha = res.get.sha;

                    if (res.get.event === 'pull_request') {
                        sha = res.get.source.sha;
                    }
                    self._setCommitStatus(buildId, res.get.authUser.token,
                                        res.get.repo,
                                        sha,
                                        status,
                                        url,
                                        callback);
                }

            }]

        }, responder('Unable to set status.', function(err, res) {
            if (err) {
                done(err, res);
            } else {
                done(null, res.get);
            }
        }));
    };

    this.clean = function(project, done) {
        var     self = this;

        async.auto({

            list: function getBuildList(callback) {
                redis.lrange(
                    'projects:' + project + ':builds',
                        0, -1, callback);
            },

            keys: ['list', function getBuildLogKeys(callback, res) {
                var keys = [];
                keys.push('projects:' + project + ':builds');
                async.map(res.list, function(buildId, cb2) {

                    keys.push('builds:' + buildId);
                    keys.push('builds:' + buildId + ':logs');
                    redis.lrange('builds:' + buildId + ':logs', 0, -1, cb2);

                }, function(err, data) {
                    if (err) callback(err);
                    else {
                        for (var index in data) {
                           keys = keys.concat(data[index]);
                        }
                        callback(null, keys);
                    }
                });
            }],

            clean: ['keys', function removeAllKeys(callback, res) {
                redis.del(res.keys, callback);
            }],

            cleanQueues: ['list', function removeFromQueues(callback, res) {
                var multi = redis.multi();
                for (var index in res.list) {
                    for (var status in config.statusMap) {
                        multi.lrem(status + ':builds', 0, res.list[index]);
                    }
                }
                multi.exec(callback);
            }]
        }, responder('Unable to clean up build keys.', done));
    },

    this.log = function(buildId, message, url, done) {
        this.status(buildId, 'running', message, url, done);
    };

    this.start = function(buildId, message, url, done) {
       this.status(buildId, 'started', message, url, done);
    };

    this.complete = function(buildId, message, url, done) {
        this.status(buildId, 'completed', message, url, done);
    };

    this.failure = function(buildId, message, url, done) {
        this.status(buildId, 'failed', message, url, done);
    };

    this.error = function(buildId, message, done) {
        this.status(buildId, 'error', message, done);
    };

};