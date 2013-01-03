module.exports  = {
    development: true,
    production: false,
    staging: false,
    logLevel: "debug",
    site: "http://localhost:8080",
    hookReceiver: 'http://requestb.in/1gwo32h1',
    db: {
        host: null,
        port: null
    },
    q: {
        host: null,
        port: null
    },
    api: {
        ip: '0.0.0.0',
        port: 8081,
        url: "http://localhost:8081"
    },
    socket: {
        origins: "*:*, localhost:8080"
    },
    auth: {
        clientId: "c62353d0f816a5f3f50f",
        clientSecret: "c6559170c9f43bd225138fbfabf8ce1d4e37c5f8"
    }
};