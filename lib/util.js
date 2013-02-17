var errors = require('node-restify-errors');

/**
 * A simple way to extend a given object with attributes from another. Shallow.
 * @param  {object} a  Object to extend.
 * @param  {object} b  Object with attributes to extend `Object a`.
 */
var extend = module.exports.extend = function(a, b) { for (var x in b) a[x] = b[x]; };

/**
 * Compose a new object with attributes from given objects
 * @return {object} Object with attributes from arguments.
 */
module.exports.compose = function() {
    var res = {};
    for (var item in arguments) {
        extend(res, arguments[item]);
    }
    return res;
};

/**
 * Restrict middleware to protect resources from unauthorized accesss.
 * @param  {object}   req  Express request object.
 * @param  {object}   res  Express response object.
 * @param  {Function} next Next middleware/action to invoke.
 */
module.exports.restrict = function(req, res, next) {
    if (req.session.accessToken) {
        next();
    } else {
        res.send(new errors.InvalidCredentialsError("Cannot authenticate with github"));
    }
};

/**
 * Evaluates error and callback with appropriate response.
 * @param  {string or function or any}   message If its a string,
 * an internal error is returned. If its a function, the return value
 * of the function is returned. If its anything else, its returned as is.
 * @param  {Function} callback The callback to be evoked.
 * @return {Function} A typical node callback function that takes two parameters,
 * err and res.
 */
module.exports.responder = function(message, callback) {
    console.log("Creating responder [" + message + "]");
    return function(err, res) {
        if (err) {
            if (typeof message === "string") {
                err = new errors.InternalError('Server error. ' + message);
            } else if (typeof message === "Function") {
                err = message(err);
            }
            console.log("Error occurred [" + err + "]");
            console.error(err);
            if (process.env.NODE_ENV !== 'production') {
                console.trace('Error occurred.');
            }
        }
        callback(err, res);
    };
};