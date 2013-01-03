var     config = require('../lib/config')
    ,   express = require('express')
    ,   errors = require('node-restify-errors')
    ,   GithubModel = require('../lib/model/github')
    ,   githubModel = new GithubModel(config.github)
    ,   kue = require('kue')
    ,   redis = require('redis').createClient(config.db.port, config.db.host)
    ,   util = require('../lib/util')
    ,   restrict = util.restrict
    ,   responder = util.responder
    ,   User = require('../lib/model/account').User
    ,   user = new User(redis, githubModel)
    ,   Project = require('../lib/model/project').Project
    ,   project = new Project(redis, githubModel)
    ,   app = module.exports = express();

kue.redis.createClient = function() {
    return require('redis').createClient(config.q.port, config.q.host);
};

var jobs = kue.createQueue();

function getRepos(req, res) {
    var     token = req.session.accessToken
        ,   username = req.session.username;
    user.getRepos(token, username, responder('Cannot get user repositories.', function(err, ret) {
        res.send(err||ret);
    }));
}

function getProjects(req, res) {
    var     token = req.session.accessToken
        ,   username = req.session.username;
    user.getProjects(token, username, responder('Cannot retrieve projects.', function(err, ret) {
        res.send(err||ret);
    }));
}

function syncProjectJob(token, username, repo) {
    jobs.create('project:sync', {
                    username: username,
                    token: token,
                    repo: repo
                }).save();
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
            jobs.create('project:clean', {
                    username: username,
                    token: token,
                    repo: repo
                }).save();
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
app.del(routes.project, restrict, deleteProject);