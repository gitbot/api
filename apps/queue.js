var     config = require('../lib/config')
    ,   factory = require('../lib/factory')
    ,   kue =  factory.Kue(config)
    ,   ping  = require('../lib/ping');


kue.app.use(ping());
kue.app.listen(config.queue.port, config.queue.ip);
console.log('Kue is listening at [%s]:[%s]', config.queue.ip, config.queue.port);