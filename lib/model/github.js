var     config = require('../config')
    ,   request = require('superagent');

var Github = module.exports = function(gh) {
    this.gh = gh;
};

Github.prototype.getRepos = function(token, done) {

    request
        .get(this.gh.reposUrl)
        .query({ access_token: token })
        .set('Accept', 'application/json')
        .end(function(err, res) {
            done(err, res.body);
        });
};

Github.prototype.getOrgs = function(token, done) {

    request
        .get(this.gh.orgsUrl)
        .query({ access_token: token })
        .set('Accept', 'application/json')
        .end(function(err, res) {
            done(err, res.body);
        });
};

Github.prototype.getOrgRepos = function(token, org, done) {

    request
        .get(this.gh.orgReposUrl.replace('{org}', org))
        .query({ access_token: token })
        .set('Accept', 'application/json')
        .end(function(err, res) {
            done(err, res.body);
        });
};
Github.prototype.addHook = function(token, project, repo, event, done) {
    var receiver = config.hookReceiver
                            .replace('{project}', encodeURIComponent(project))
                            .replace('{event}', encodeURIComponent(event));
    request
        .post(this.gh.addHookUrl.replace('{repo}', repo))
        .query({ access_token: token })
        .send({
            name: 'web',
            events: [event],
            active: true,
            config: {
                content_type: 'json',
                url: receiver
            }
        })
        .set('Accept', 'application/json')
        .end(function(err, res) {
            done(err, res.body);
        });
};

Github.prototype.removeHook = function(token, repo, hookId, done) {
    if (!hookId || hookId === "undefined") {
        done(null, {success: true});
        return;
    }
    request
        .del(this.gh.removeHookUrl.replace('{repo}', repo)
                                .replace('{hook}', hookId))
        .set('Content-Length', 0)
        .query({ access_token: token })
        .end(function(err, res) {
            if (err) console.error(err);
            done(err, res.body);
        });
};

Github.prototype.fetchConfig = function(token, repo, done) {
    request
        .get(this.gh.configUrl.replace('{repo}', repo))
        .query({ access_token: token })
        .end(function(err, res) {
            if (err) {
                done (err);
            } else {
                done(null, new Buffer(res.body.content, "base64").toString('utf-8'));
            }
        });
};

Github.prototype.setStatus = function(token, repo, sha, data, done) {
    request
        .post(this.gh.statusUrl.replace('{repo}', repo).replace('{sha}', sha))
        .query({ access_token: token })
        .set('Accept', 'application/json')
        .send(data)
        .end(function(err, res) {
            if (err) {
                done (err);
            } else {
                if (!res.ok) {
                    done(res.body);
                } else {
                    console.error('Posting status to github failed.');
                    console.error({
                        repo: repo,
                        sha: sha,
                        data: data,
                        response: res.body,
                        response_text: res.text
                    });
                    done(null, res.body);
                }
            }
        });
};