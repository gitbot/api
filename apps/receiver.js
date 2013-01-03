var     async = require('async')
    ,   config = require('../lib/config')
    ,   express = require('express')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   kue = require('kue')
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


    async.waterfall([
            function findAction(done) {
                project.findAction(proj, event, repo, branch, done);
            },
            function triggerAction(action, done) {
                if (!action) {
                    return done('Cannot find an action for the received hook.');
                }
                jobs.create('action:trigger', {
                    project: proj,
                    action: action,
                    repo: repo,
                    branch: branch,
                    sha: sha
                }).save();
                project.getAuthUser(proj, function(err, result) {
                    if (err) done(err);
                    else {
                        done (null, result, action);
                    }

                });
            },
            function setStatus(authUser, action, done) {
                githubModel.setStatus(authUser.token, repo, sha, {
                    state: 'pending',
                    description: 'Action triggered.'
                }, done);
            }
        ],
        responder('Cannot consume action', function() {

            // TODO: Figure out logging bad events properly to facilitate clean up.
            res.send({success: true});
        }
    ));
}


app.post('/project', projectHook);
app.post('/:project/action/:event', actionHook);