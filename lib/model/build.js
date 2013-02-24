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
                var build = {};
                build.created = Date.now().valueOf().toString();
                build.authUser = authUser;
                build.project = trigger.project;
                build.repo = trigger.repo;
                build.branch = trigger.branch;
                build.sha = trigger.sha;
                build.status = status;
                build.event = trigger.event;
                build.action = action;
                build.id = hashId(build);
                callback(null, build);
            },

            save: ["make", function(callback, res) {
                redis.multi()
                .hmset('builds:' + res.make.id, res.make)
                .rpush('projects:' + res.make.project + ':builds', res.make.id)
                .rpush(status + ':builds', res.make.id)
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
                data.status_url = config.statusReceiver.replace('{jobId}', data.id);
                data.github_oauth = res.make.authUser.token;
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
                },  function(err, data) {
                    if (err) {
                        done(err, data);
                    } else {
                        console.log(
                            'New action triggered with job id:' + res.make.id);
                        res.make.sqsMessageId = data.MessageId;
                        callback(null, res.make);
                    }
                });
            }],

            github: ["send", function(callback, res) {
                self._setCommitStatus(res.send.id, authUser.token,
                    res.send.repo, res.send.sha,
                    'started',
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
                redis.get(buildKey, callback);
            },

            save: ['get', function(callback, res) {

                if (res.get.status === status) {

                    // If the status has not changed
                    // Just Update the log

                    self._updateLog(buildId, status, message, callback);

                } else {

                    // If it has changed

                    var     newStatusKey = res.get.status + ':builds'
                        ,   multi = redis.multi();

                    multi

                        // Update the object
                        .hset(buildKey, 'status', status)

                        // Update the queues
                        .lrem(currentStatusKey, 0, buildId)
                        .rpush(newStatusKey, buildId);

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
                    self._setCommitStatus(buildId, res.get.authUser.token,
                                        res.get.repo,
                                        res.get.sha,
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