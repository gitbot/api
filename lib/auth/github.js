var     async = require('async')
    ,   crypto = require('crypto')
    ,   request = require('superagent')
    ,   qs = require('qs');

var Github = module.exports = function(config) {
    this.config = config;
    this.auth = config.auth;
    this.gh = config.github;
};

Github.prototype.getAuthUrl = function(scope, callbackUri, done) {
    var self = this;
    if (Array.isArray(scope)) {
        scope = scope.join(',');
    }
    async.waterfall([
        function(callback) {
            crypto.randomBytes(48, function(ex, buf) {
                callback(null, buf.toString('hex'));
            });
        },
        function(state, callback) {
            var query = qs.stringify({
                client_id: self.auth.clientId,
                scope: scope,
                state: state
            });
            callback(null, {
                state: state,
                url: self.gh.authUrl + '?' + query
            });
        }
    ], done);
};

Github.prototype.getAccessToken = function(code, state, done) {
    var params = {
        client_id: this.auth.clientId,
        client_secret: this.auth.clientSecret,
        code: code,
        state: state
    };
    request
        .post(this.gh.tokenUrl)
        .send(params)
        .set('Accept', 'application/json')
        .set('User-Agent', 'gitbot/superagent/0.1')
        .end(function(err, res) {
            done(err, res.body);
        });
};

Github.prototype.getUserProfile = function(token, done) {
    var params = {
        access_token: token
    };
    var url = this.gh.profileUrl + '?' + qs.stringify(params);
    request
        .get(url)
        .set('Accept', 'application/json')
        .set('User-Agent', 'gitbot/superagent/0.1')
        .end(function(err, res) {
            done(err, res.body);
        });
};