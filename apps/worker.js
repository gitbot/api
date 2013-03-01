var     config = require('../lib/config')
    ,   factory = require('../lib/factory')
    ,   aws = require('aws-sdk')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config)
    ,   sub = factory.Redis(config)
    ,   pub = factory.Redis(config)
    ,   redis = factory.Redis(config)
    ,   User = require('../lib/model/account').User
    ,   user = new User(config, redis)
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(config, redis)
    ,   Builds = require('../lib/model/build')
    ,   builds = new Builds(config, redis);

sub.subscribe('user:sync');
sub.subscribe('project:sync');
sub.subscribe('project:autosync');
sub.subscribe('project:clean');
sub.subscribe('build:trigger');
sub.subscribe('build:status');

sub.on('message', function(channel, message) {
    var responseChannel;

    var userResponseChannel = function(data) {
        return data.username + ':user:status';
    };

    var projectResponseChannel = function(data) {
        return data.repo + ':project:status';
    };

    var buildResponseChannel = function(data) {
        return data.project + ':build:status';
    };

    var done = function(err, res) {
        if (err) {
            console.error(err);
            pub.publish(responseChannel, 'error');
            return;
        } else {
            pub.publish(responseChannel, 'ready');
        }
    };

    var data = JSON.parse(message);
    if (channel === 'user:sync') {
        responseChannel = userResponseChannel(data);
        user.sync(data.token, data.username, done);
    } else if (channel === 'project:sync') {
        responseChannel = projectResponseChannel(data);
        project.sync(data.token, data.username, data.repo, done);
    } else if (channel === 'project:autosync') {
        responseChannel = projectResponseChannel(data);
        project.autoSync(data.repo, done);
    } else if (channel === 'project:clean') {
        responseChannel = projectResponseChannel(data);
        project.clean(data.token, data.username, data.repo, done);
    } else if (channel === 'build:trigger') {
        responseChannel = buildResponseChannel(data);
        project.trigger(data, done);
    } else if (channel === 'build:status') {
        responseChannel = buildResponseChannel(data);
        builds.status(data.jobId, data.state, data.message, data.url, done);
    }
});
console.log('Worker process started');