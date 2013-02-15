var     cluster = require('cluster')
    ,   config = require('../lib/config')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   kue = require('kue')
    ,   redis = require('redis').createClient(config.db.port, config.db.host)
    ,   User = require('../lib/model/account').User
    ,   user = new User(redis, githubModel)
    ,   ping  = require('../lib/ping')
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(redis, githubModel)
    ,   Job = kue.Job;

kue.redis.createClient = function() {
    return require('redis').createClient(config.db.port, config.db.host);
};

var jobs = kue.createQueue();


if (cluster.isMaster) {

    var numCPUs = require('os').cpus().length;
    for (var i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    console.log( numCPUs + ' workers started for processing jobs');
    kue.app.use(ping());

    kue.app.listen(config.queue.port, config.queue.ip);
    console.log('Kue is listening at [%s]:[%s]', config.queue.ip, config.queue.port);

    cluster.on('exit', function(worker) {
        console.log('worker ' + worker.process.pid + ' died');
        cluster.fork();
    });

    jobs.on('job complete', function(id) {
        Job.get(id, function(err, job){
            if (err) return;
            job.remove(function(err){
                if (err) throw err;
            });
            console.log('Job [' + job.id + '] complete');
            if (job.id === 'user:sync') {
                console.log('User sync complete');
                redis.publish(job.data.username + ':ready', {success: true});
            } else if (job.id === 'project:sync' ||
                        job.id === 'project:autosync' ||
                        job.id === 'project:clean' ) {
                console.log('Project job complete');
                redis.publish(job.data.username + ':project:ready', {success: true});
            }
            
        });
    });

} else {

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
        job.status_url = config.statusReceiver.replace('{jobId}', job.id);
        project.triggerAction(job, done);
    });
}