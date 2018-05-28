const url = require('url')
const tls = require("tls");
const LruCache = require('./lru');
const factory = require('./redis');
const to = require('./to')


class Cache {
    constructor(config) {
        this.config = config;

        this.log = function (msg) {
            console.log(msg);
        };

        this.client = new factory(config.redis);


        this.lru = new LruCache();

        if (config.lru) {
            this.lru.enabled = config.lru;
        } else {
            this.lru.enabled = false;
        }

        this.attachEvents()

    }

    attachEvents() {
        let self = this;

        this.client.on('backend.reload', function (key) {
            self.lru.del(key)
        });

    }

    markDeadBackend(backendInfo) {
        this.client.mark(backendInfo.frontend, backendInfo.id,
            backendInfo.url, backendInfo.index, this.config.deadBackendTTL);

        // A dead backend invalidates the LRU
        this.lru.del(backendInfo.frontend);

    }

    getDomainsLookup(hostname) {
        var parts = hostname.split('.');
        var result = [parts.join('.')];
        var n;
        // Prevent abusive lookups
        while (parts.length > 6) {
            parts.shift();
        }
        while (parts.length > 1) {
            parts.shift();
            n = parts.join('.');
            result.push('*.' + n);
        }
        result.push('*');
        return result;
    }

    async readFromCache(hostKey, explicit = false) {
        let rows;

        rows = this.lru.get(hostKey);
        if (rows) {
            return Promise.resolve(rows.slice(0))
        }

        try {
            rows = await this.client.read(explicit ? [hostKey] : this.getDomainsLookup(hostKey), 'backend')
        } catch (err) {
            return Promise.reject(err)
        }


        let backends = rows.shift();

        while (rows.length && !backends.length) {
            backends = rows.shift();
        }

        if (!backends.length) {
            return Promise.resolve([])
        }


        for (var i = 0,
                 j = backends.length; i < j; i++) {
            try {
                backends[i] = JSON.parse(backends[i])
            } catch (e) {

            }
        }
        if (backends.length > 1) {
            this.lru.set(hostKey, backends);
        }
        return Promise.resolve(backends.slice(0));
    }

    async getBackendFromHostHeader(host) {
        if (host === undefined) {
            return Promise.reject(new Error('no host header'));
        }

        let index = host.indexOf(':');
        if (index > 0) {
            host = host.slice(0, index).toLowerCase();
        }

        let backends;
        try {
            backends = await this.readFromCache(host);
        } catch (err) {
            return Promise.reject(err);
        }

        if (!backends.length) {
            let err = new Error('No Application Configured');
            err.code = 400;
            return Promise.reject(err);
        }

        let info = backends[0]
        backends = backends.slice(1);

        if (!backends.length) {
            let err = new Error('Application is offline');
            err.code = 502;
            return Promise.reject(err);
        }
        let backend = backends[Math.floor(Math.random() * backends.length)]

        backend.logSession = info.logSession;
        backend.metricSession = info.metricSession;
        backend.virtualHost = info.virtualHost;
        backend.frontend = host;
        backend.name = 'web.1';

        return Promise.resolve(backend)
    }

    getSNIFromHostHeader(host) {
        let self = this;
        let index = host.indexOf(':');
        if (index > 0) {
            host = host.slice(0, index).toLowerCase();
        }
        host = 'tls:' + host;

        return new Promise(async function (resolve, reject) {
            // Let's try the LRU cache first
            let ctx = this.lru.get(host);
            if (ctx) {
                return resolve(ctx);
            }

            // The entry is not in the LRU cache, let's do a request on Redis

            try {
                let data = await self.client.sni(host);
                if (!data) {
                    return reject(new Error('bad domain'))
                }
                ctx = tls.createSecureContext({
                    key: data.key,
                    cert: data.certificate,
                });
                self.lru.set(host, ctx);
                resolve(ctx);
            } catch (err) {
                reject(err)
            }
        })
    }
}

module.exports = Cache;