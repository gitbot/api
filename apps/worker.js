var     config = require('../lib/config')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   kue = require('kue')
    ,   noderedis = require('redis')
    ,   redis = noderedis.createClient(config.db.port, config.db.host)
    ,   User = require('../lib/model/account').User
    ,   user = new User(redis, githubModel)
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(redis, githubModel)
    ,   Job = kue.Job;
    
kue.redis.createClient = function() {
    return noderedis.createClient(config.db.port, config.db.host);
};

var jobs = kue.createQueue();
jobs.on('job complete', function(id) {
    Job.get(id, function(err, job){
        if (err) {
            console.error(err);
            return;
        }
        var redisPub = noderedis.createClient(config.db.port, config.db.host);
        if (job.type === 'user:sync') {
            redisPub.publish(job.data.username + ':user:ready', "ready");
        } else if (job.type === 'project:sync' ||
                    job.type === 'project:autosync' ||
                    job.type === 'project:clean' ) {
            redisPub.publish(job.data.username + ':project:ready', "ready");
        }
        redisPub.quit();
        job.remove(function(err){
            if (err) throw err;
        });
    });
});

jobs.process('user:sync', function(job, done) {
    user.sync(job.data.token, job.data.username, done);
});

jobs.process('project:sync', function(job, done) {
    project.sync(job.data.token, job.data.username, job.data.repo, done);
});

jobs.process('project:autosync', function(job, done) {
    project.autoSync(job.data.repo, done);
});

jobs.process('project:clean', function(job, done) {
    project.clean(job.data.token, job.data.username, job.data.repo, done);
});

jobs.process('action:trigger', function(job, done) {
    var data = JSON.parse(JSON.stringify(job.data));
    delete data.authUser;
    data.status_url = config.statusReceiver.replace('{jobId}', job.id);
    data.github_oauth = job.data.authUser.token;
    project.triggerAction(data, function(err, res) {
        if (err) {
            done(err, res);
        } else {
            console.log('New action triggered with job id:' + job.id);
        }
    });
});