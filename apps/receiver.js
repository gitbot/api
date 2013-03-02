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

    function triggerProjectAction(data, res) {
        if (data.event === 'push') {
            data.fetch = data.ref;
        } else {
            data.fetch = 'refs/pull/' + data.number + '/head';
        }

        redisPub.publish('build:trigger', JSON.stringify(data));
        res.send({success: true});
    }

    function actionTriggerHook(req, res) {

        var data = {
            project: req.params.project,
            repo: req.body.repo,
            branch: req.body.branch,
            sha: req.body.sha,
            event: req.body.event
        };

        if (data.event !== 'push') {
            data.source = req.body.source;
            data.action = req.body.action;
            data.number = req.body.number;
        }

        triggerProjectAction(data, res);
    }

    function actionHook(req, res) {
        var     result = {}
            ,   data = req.body;

        result.project = req.params.project;
        result.event = req.params.event;


        if (result.event === 'push') {
            result.repo = data.repository.owner.name + '/' +
                            data.repository.name;
            result.ref = data.ref;
            result.branch = data.ref.replace('refs/heads/','');
            result.sha = data.after;
        } else {
            result.repo = data.pull_request.base.repo.full_name;
            result.ref = data.pull_request.base.ref;
            result.branch = result.ref.replace('refs/heads/','');
            result.sha = data.pull_request.base.sha;
            result.praction = data.action;
            result.number = data.number;
            result.source = {
                repo: data.pull_request.head.repo.full_name,
                branch: data.pull_request.head.ref.replace('refs/heads/',''),
                sha: data.pull_request.head.sha,
                ref: data.pull_request.head.ref
            };
        }
        triggerProjectAction(result, res);
    }

    function actionStatusHook(req, res) {
        var jobId = req.params.jobId;
        var status = req.body;
        redisPub.publish('build:status', JSON.stringify({
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