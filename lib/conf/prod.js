module.exports  = {
    development: false,
    production: true,
    staging: false,
    logLevel: "info",
    site: "{{site}}",
    hookReceiver: 'http://{{api}}:{{port}}/hooks',
    db: {
        host: "{{dbHost}}",
        port: {{dbPort}}
    },
    q: {
        host: "{{qHost}}",
        port: {{qPort}}
    },
    api: {
        ip: '{{api}}',
        port: {{port}},
        url: "http://{{api}}:8081"
    },
    queue: {
        ip: '{{queue}}',
        port: {{qport}},
        url: "http://{{queue}}:{{qport}}"
    },
    socket: {
        origins: "*:*, {{site}}:8181"
    },
    auth: {
        clientId: "{{clientId}}",
        clientSecret: "{{clientSecret}}"
    }
};