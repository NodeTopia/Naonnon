const redis = require('redis');
const util = require('util');
const EventEmitter = require('events').EventEmitter;


class Redis extends EventEmitter {
    constructor(options) {
        super();

        this.clientReady = false;
        this.prefix = '';


        this.client = redis.createClient(options.port || 6379, options.host || '127.0.0.1');
        if (options.auth) {
            this.client.auth(options.auth);
        }
        if (options.prefix) {
            this.prefix = options.prefix;
        }

        if (options.db) {
            this.client.select(options.db);
        }
    }

    get connected() {
        return this.client.connected;
    }

    read(hosts, type) {

        let multi = this.client.multi();
        let first = hosts[0]

        for (let host of hosts) {
            multi.lrange(`${this.prefix}${type}:${host}`, 0, -1);
        }

        multi.smembers(this.prefix + 'dead:' + first);

        return new Promise(function (resolve, reject) {
            multi.exec(function (err, data) {
                if (err) {
                    reject(err)
                } else {
                    resolve(data)
                }
            })
        });
    }

    mark(frontend, id, url, index, ttl) {
        var frontendKey = this.prefix + 'dead:' + frontend;
        var multi = this.client.multi();


        multi.sadd(frontendKey, id);
        multi.expire(frontendKey, ttl);

        // Announce the dead backend on the "dead" channel
        multi.publish('dead', frontend + ';' + url + ';' + id + ';' + index);

        return new Promise(function (resolve, reject) {
            multi.exec(function (err, data) {
                if (err) {
                    reject(err)
                } else {
                    resolve(data)
                }
            });
        })

    }

    sni(host) {
        let self = this;
        return new Promise(function (resolve, reject) {
            self.client.hgetall(self.prefix + host, function (err, data) {
                if (err) {
                    reject(err)
                } else {
                    resolve(data)
                }
            });
        })
    }
}


module.exports = Redis;