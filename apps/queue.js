var     config = require('../lib/config')
    ,   kue = require('kue')
    ,   noderedis = require('redis')
    ,   ping  = require('../lib/ping');
    
kue.redis.createClient = function() {
    return noderedis.createClient(config.db.port, config.db.host);
};

kue.app.use(ping());
kue.app.listen(config.queue.port, config.queue.ip);
console.log('Kue is listening at [%s]:[%s]', config.queue.ip, config.queue.port);