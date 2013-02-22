/*global require:true, module:true, console:true */
var     express = require('express')
    ,   config = require('./lib/config')
    ,   factory = require('./lib/factory')
    ,   redis = factory.Redis(config)
    ,   app = express()
    ,   ping  = require('./lib/ping')
    ,   auth = require('./apps/auth')
    ,   events = require('./apps/events')
    ,   http = require('http')
    ,   user = require('./apps/user')
    ,   receiver = require('./apps/receiver')
    ,   Session = require('./lib/model/account').Session
    ,   session = new Session(redis);

var AUTH_HEADER = 'x-auth-authcode';

var ALLOWED_HEADERS = [
    'content-type',
    'x-requested-with',
    AUTH_HEADER
];
var allowCrossDomain = function(req, res, next) {
    // TODO: Get these from config
    res.set('Access-Control-Allow-Origin', req.headers.origin || "*");
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH, DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','));

    next();
};

var authcode = function(session) {

    return function simpleAuthCodeHandler(req, res, next) {

        req.session = {};
        var authcode = req.session.authcode =
                                            req.headers[AUTH_HEADER] ||
                                            (req.body && req.body.authcode) ||
                                            (req.query && req.query.authcode);
        if (authcode) {
            session.find(authcode,
                            function(err, data) {
                                if (!err) {
                                    req.session.accessToken = data.accessToken;
                                    req.session.username = data.username;
                                }
                                next();
                            });
        } else {
            next();
        }
    };
};

var responseError = function(req, res, next) {
    var rsend = res.send;
    res.send = function() {
        if (arguments[0].statusCode && arguments[0].body) {
            return rsend.call(res, arguments[0].statusCode, arguments[0].body);
        } else {
            return rsend.apply(res, arguments);
        }
    };
    next();
};

app.locals.jobs = factory.Kue(config);

app.configure(function() {
    app.enable('trust proxy');
    app.use(responseError);
    app.use(express.bodyParser());
    app.use(express.logger('dev')); // TODO: Get this from config
    app.use(allowCrossDomain);
    app.use(authcode(session));
    app.use(app.router);
    app.use(ping());
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.use('/auth', auth);
app.use('/user', user);
app.use('/hooks', receiver);

app.options('*', function(req, res) {
    res.send({success: true});
});

if (!module.parent) {
    var server = http.createServer(app);
    server.listen(config.api.port, config.api.ip);
    events.listen(server);
    console.log('Express is listening at [%s]:[%s]', config.api.ip, config.api.port);
}