module.exports = function(config) {

    config = config || require('../lib/config');

    var     factory = require('../lib/factory')
        ,   express = require('express')
        ,   errors = require('../lib/node-restify-errors')
        ,   GithubModel = require('../lib/model/github')
        ,   githubModel = new GithubModel(config)
        ,   redis = factory.Redis(config)
        ,   redisPub = factory.Redis(config)
        ,   util = require('../lib/util')
        ,   restrict = util.restrict
        ,   responder = util.responder
        ,   User = require('../lib/model/account').User
        ,   user = new User(config, redis)
        ,   Project = require('../lib/model/project').Project
        ,   project = new Project(config, redis)
        ,   app = express();

    function getRepos(req, res) {
        var     token = req.session.accessToken
            ,   username = req.session.username;
        user.getRepos(token, username,
            responder('Cannot get user repositories.', function(err, ret) {
            res.send(err||ret);
        }));
    }

    function getProjects(req, res) {
        var     token = req.session.accessToken
            ,   username = req.session.username;
        user.getProjects(token, username,
            responder('Cannot retrieve projects.', function(err, ret) {
            res.send(err||ret);
        }));
    }

    function syncProjectJob(token, username, repo) {
        redisPub.publish('project:sync', JSON.stringify({
                        username: username,
                        token: token,
                        repo: repo
                    }));
    }

    function addProject(req, res) {
        var     token = req.session.accessToken
            ,   username = req.session.username
            ,   repo = req.params.repo;

        if (!repo) {
            return res.send(
                new errors.MissingParameterError(
                    'A valid repo must be provided to add a project.'
                )
            );
        }

        project.add(token, username, repo, responder('Cannot add project.', function(err) {
            if (!err) {
                syncProjectJob(token, username, repo);
            }
            res.send(err||{success: true});
        }));
    }

    function deleteProject(req, res) {
        var     token = req.session.accessToken
            ,   username = req.session.username
            ,   repo = req.params.repo;

        if (!repo) {
            return res.send(
                new errors.MissingParameterError(
                    'A valid repo must be provided to remove a project.'
                )
            );
        }

        project.remove(token, username, repo, responder('Cannot remove project.', function(err) {
            if (!err) {
                redisPub.publish('project:clean', JSON.stringify({
                        username: username,
                        token: token,
                        repo: repo
                    }));
            }
            res.send(err||{success: true});
        }));
    }

    function syncProject(req, res) {
        var     token = req.session.accessToken
            ,   username = req.session.username
            ,   repo = req.params.repo;

        if (!repo) {
            return res.send(
                new errors.MissingParameterError(
                    'A valid repo must be provided to sync a project.'
                )
            );
        }
        syncProjectJob(token, username, repo);
        res.send({success: true});
    }

    var routes = {
        repos: '/repos',
        projects: '/projects',
        project: '/projects/:repo'
    };

    app.get(routes.repos, restrict, getRepos);

    app.get(routes.projects, restrict, getProjects);
    app.put(routes.project, restrict, addProject);
    app.patch(routes.project, restrict, syncProject);
    app.delete(routes.project, restrict, deleteProject);

    return app;
};
