var     config = require('../lib/config')
    ,   factory = require('../lib/factory')
    ,   aws = require('aws-sdk')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   Job = require('kue').Job
    ,   jobs = factory.Jobs(config)
    ,   noderedis = require('redis')
    ,   redis = factory.Redis(config)
    ,   redisPub = factory.Redis(config)
    ,   User = require('../lib/model/account').User
    ,   user = new User(redis, githubModel)
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(redis, githubModel);

jobs.on('job complete', function(id) {
    Job.get(id, function(err, job){
        if (err) {
            console.error(err);
            return;
        }
        if (job.type === 'user:sync') {
            redisPub.publish(job.data.username + ':user:ready', "ready");
        } else if (job.type === 'project:sync' ||
                    job.type === 'project:autosync' ||
                    job.type === 'project:clean' ) {
            redisPub.publish(job.data.username + ':project:ready', "ready");
        }
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
    },  function(err, res) {
        if (err) {
            done(err, res);
        } else {
            console.log('New action triggered with job id:' + job.id);
        }
    });
});
console.log('Worker process started');