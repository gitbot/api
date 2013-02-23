module.exports = function(config) {

    config = config || require('../lib/config');

    var     async = require('async')
        ,   factory = require('../lib/factory')
        ,   express = require('express')
        ,   redisPub = factory.Redis(config)
        ,   util = require('../lib/util')
        ,   responder = util.responder
        ,   app = express();

    function projectHook(req, res) {
        var repo = req.body.repository.owner.name + '/' + req.body.repository.name;
        redisPub.publish('project:autosync', repo);
        res.send({success: true});
    }

    function triggerProjectAction(proj, repo, branch, sha, event, res) {
        redisPub.publish('project:trigger', JSON.stringify({
            project: proj,
            repo: repo,
            branch: branch,
            sha: sha,
            event: event
        }));
        res.send({success: true});
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
        branch = branch.replace('refs/heads/',  '');
        triggerProjectAction(proj, repo, branch, sha, event, res);
    }

    function actionStatusHook(req, res) {
        var jobId = req.params.jobId;
        var status = req.body;
        redisPub.publish('project:trigger', JSON.stringify({
            jobId: jobId,
            state: status.state,
            message: status.message,
            url: status.url
        }));
        res.send({success: true});
    }

    app.post('/gb-sync-project/action/:event', projectHook);
    app.post('/:project/action/:event', actionHook);
    app.post('/projects/:project/trigger', actionTriggerHook);
    app.post('/jobs/:jobId/status', actionStatusHook);

    return app;
};