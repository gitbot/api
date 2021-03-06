var     currentEnv = process.env.NODE_ENV || 'development'
    ,   fs = require('fs')
    ,   settings = null
    ,   compose = require('./util').compose;

var defaults = {
    development: true,
    production: false,
    staging: false,
    logLevel: "debug",
    hookReceiver: 'http://requestb.in/1gwo32h1',
    statusReceiver: 'http://requestb.in/1gwo32h1',
    messages: {
        queued: 'Gitbot:: New build is queued. {buildId}',
        started: 'Gitbot:: Build has started. {buildId}',
        running: 'Gitbot:: Build is running. {buildId}',
        completed: 'Gitbot:: Build succeeded. {buildId}',
        conflicted: 'Gitbot:: Merge failure when trying to prepare for build. {buildId}.',
        failed: 'Gitbot:: Build failed. {buildId}',
        error: 'Gitbot:: System error occurred when running the build. {buildId}'
    },
    statusMap: {
        queued: 'pending',
        started: 'pending',
        running: 'pending',
        completed: 'success',
        conflicted: 'failure',
        failed: 'failure',
        error: 'error'
    },
    github: {
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl:  'https://github.com/login/oauth/access_token',
        profileUrl: 'https://api.github.com/user',
        reposUrl: 'https://api.github.com/user/repos',
        orgsUrl: 'https://api.github.com/user/orgs',
        orgReposUrl: 'https://api.github.com/orgs/{org}/repos',
        addHookUrl: 'https://api.github.com/repos/{repo}/hooks',
        removeHookUrl: 'https://api.github.com/repos/{repo}/hooks/{hook}',
        configUrl: 'https://api.github.com/repos/{repo}/contents/gitbot.yaml',
        statusUrl: 'https://api.github.com/repos/{repo}/statuses/{sha}'
    }
};

if (currentEnv === 'production') {
    settings = require('./conf/prod');
} else if (currentEnv === 'stage') {
    settings = require('./conf/stage');
} else {
    settings = require('./conf/dev');
}

var env = {};

if (fs.existsSync('.env')) {
    env = JSON.parse(fs.readFileSync('.env', 'ascii'));
}
module.exports = compose(defaults, settings, env);