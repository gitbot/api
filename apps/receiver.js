var     async = require('async')
    ,   config = require('../lib/config')
    ,   express = require('express')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   kue = require('kue')
    ,   Job = kue.Job
    ,   redis = require('redis').createClient(config.db.port, config.db.host)
    ,   util = require('../lib/util')
    ,   responder = util.responder
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(redis, githubModel)
    ,   app = module.exports = express();


kue.redis.createClient = function() {
    return require('redis').createClient(config.q.port, config.q.host);
};

var jobs = kue.createQueue();

function projectHook(req, res) {
    var repo = req.body.repository.owner.name + '/' + req.body.repository.name;
    jobs.create('project:autosync', {repo: repo}).save();
    res.send({success: true});
}

function triggerProjectAction(proj, repo, branch, sha, event, res) {
    branch = branch.replace('refs/heads/',  '');
    async.waterfall([
    
        function findAction(done) {
            project.findAction(proj, event, repo, branch, done);
        },

        function getAuthUser(action, done) {
            if (!action) {
                return done('Cannot find an action for the received hook.');
            }
            project.getAuthUser(proj, function(err, result) {
                if (err) done(err);
                else {
                    done (null, result, action);
                }
            });
        },
        
        function triggerAction(authUser, action, done) {
            
            jobs.create('action:trigger', {
                authUser: authUser,
                project: proj,
                action: action,
                repo: repo,
                branch: branch,
                sha: sha
            }).save();

            done(null, authUser, action);
        },
       
        function setStatus(authUser, action, done) {
            githubModel.setStatus(authUser.token, repo, sha, {
                state: 'pending',
                description: 'Gitbot:: New build triggered.'
            }, done);
        }
    ], responder('Cannot consume action', function() {
            // TODO: Figure out logging bad events properly to facilitate clean up.
            res.send({success: true});
        }
    ));
}

function actionTriggerHook(req, res) {
    var     proj = req.params.project
        ,   repo = req.body.repo
        ,   branch = req.body.branch
        ,   sha = req.body.sha
        ,   event = req.body.event;
    triggerProjectAction(proj, repo, branch, sha, event, res);
}

function actionHook(req, res) {
    var     repo, branch, sha
        ,   proj = req.params.project
        ,   event = req.params.event;

    if (event === 'push') {
            repo = req.body.repository.owner.name + '/' + req.body.repository.name
        ,   branch = req.body.ref
        ,   sha = req.body.after;
    } else {
            repo = req.body.pull_request.head.repo.full_name
        ,   branch = req.body.pull_request.head.ref
        ,   sha = req.body.pull_request.head.sha;
    }
    triggerProjectAction(proj, repo, branch, sha, event, res);
}


function setStatus(job, data, res) {
    githubModel.setStatus(job.data.authUser.token,
                    job.data.repo, job.data.sha, data,
                    function(err) {
        if (err) {
            // TODO: Handle this gracefully.
            job.log(err);
            console.error('Error occurred when setting status.');
            console.error(err);
            res.send(
                {success:false, message:'Unable to set commit status.'},
                424);
        } else {
            res.send({success: true});
        }
    });
}

function actionStatusHook(req, res) {
    var jobId = req.params.jobId;
    var status = req.body;
    Job.get(jobId, function(err, job) {
        if (err) {
            // TODO: Handle this gracefully.
            console.error(err);
            res.send(
                {success: false, message: 'Job not found'},
                410);
        } else {
            if (status.state === 'complete') {
            
                job.complete();
                setStatus(job, {
                    state: 'success',
                    description: status.message,
                    url: status.url
                }, res);
            } else if (status.state === 'working') {
             
                job.log(status.message);
                setStatus(job, {
                    state: 'pending',
                    description: status.message,
                    url: status.url || null
                }, res);

            } else if (status.state === 'error' || status.state === 'failure') {
                
                job.log('An error occurred when processing the job.[' + status.message);
                job.failed();
                setStatus(job, {
                    state: status.state,
                    description: status.message,
                    url: status.url || null
                }, res);
            }
        }
    });
}

app.post('/gb-sync-project/action/:event', projectHook);
app.post('/:project/action/:event', actionHook);
app.post('/projects/:project/trigger', actionTriggerHook);
app.post('/jobs/:jobId/status', actionStatusHook);