const http = require('http');
const https = require('https');
const fs = require('fs');
const httpProxy = require('http-proxy');

const Cache = require('./cache');
const Meta = require('./meta');
const NodeRedisPubsub = require('noderedispubsub');
const AccessLogger = require('./accesslogger');
const Metrics = require('./metrics');


class Worker {
    constructor(config) {

        this.config = config;

        this.cache = config.Config ? new config.Config(config) : new Cache(config);
        this.accessLog = new AccessLogger(config.logging);
        this.metrics = new Metrics(config.metrics);


        if (config.pubsub) {
            this.pubsub = new NodeRedisPubsub(config.pubsub)
        }
        this.setupHTTPProxy()
    }

    setupHTTPProxy() {
        let options = {};
        if (this.config.httpKeepAlive !== true) {
            // Disable the http Agent of the http-proxy library so we force
            // the proxy to close the connection after each request to the backend
            options.agent = false;
        }
        this.proxy = httpProxy.createProxyServer(options);
        http.globalAgent.maxSockets = this.config.maxSockets;
        https.globalAgent.maxSockets = this.config.maxSockets;


        // Set proxy handlers
        this.proxy.on('error', this.proxyErrorHandler.bind(this));
        this.proxy.on('start', this.startHandler.bind(this));
        this.setupHTTP();
        if (this.config.https)
            this.setupHTTPs();

    }

    setupHTTP() {
        let self = this;
        this.httpServer = http.createServer(this.httpRequestHandler.bind(this));
        this.httpServer.on('connection', this.tcpConnectionHandler.bind(this));
        this.httpServer.on('upgrade', this.wsRequestHandler.bind(this));
        this.httpServer.on('upgrade', this.wsRequestHandler.bind(this));

        this.httpServer.listen(this.config.port, function () {
            var host = self.httpServer.address().address;
            var port = self.httpServer.address().port;
            console.log('running at http://' + host + ':' + port)
        });
    }

    setupHTTPs() {
        let self = this;
        let options = this.config.https;
        options.key = fs.readFileSync(options.key, 'utf8');
        options.cert = fs.readFileSync(options.cert, 'utf8');
        options.SNICallback = async function (servername, cb) {
            try {
                let ctx = await self.cache.getSNIFromHostHeader(servername)
                if (ctx)
                    return cb(null, ctx);
            } catch (err) {
                return cb(err);
            }
            return cb(new Error('bad domain'));
        }
        this.httpsServer = https.createServer(options, this.httpRequestHandler.bind(this));

        this.httpsServer.on('connection', this.tcpConnectionHandler.bind(this));
        this.httpsServer.on('upgrade', this.wsRequestHandler.bind(this));
        this.httpsServer.listen(this.config.https.port, function () {
            var host = self.httpsServer.address().address;
            var port = self.httpsServer.address().port;
            console.log('running at https://' + host + ':' + port)
        });
    }

    proxyErrorHandler(err, req, res) {
        let backendId = req.meta.id;
        if (err.code === 'ECONNREFUSED' ||
            err.code === 'ETIMEDOUT' ||
            req.error !== undefined) {
            // This backend is dead
            if (req.meta.index > 1) {
                this.cache.markDeadBackend(req.meta);
            }
            if (req.error) {
                err = req.error;
                // Clearing the error
                delete req.error;
            }
            console.log(req.headers.host + ': backend #' + backendId + ' is dead (' + JSON.stringify(err) +
                ') while handling request for ' + req.url);
        } else {
            console.log(req.headers.host + ': backend #' + backendId + ' reported an error (' +
                JSON.stringify(err) + ') while handling request for ' + req.url);
        }

        req.retries = (req.retries === undefined) ? 0 : req.retries + 1;

        if (!res.connection || res.connection.destroyed === true) {
            console.log(req.headers.host + ': Response socket already closed, aborting.');
            try {
                return this.errorMessage(req, res, 'Cannot retry on error', 502);
            } catch (err) {
                console.log(req.headers.host + ': Cannot end the request properly (' + err + ').');
            }
        }
        if (req.retries >= this.config.retryOnError) {
            if (this.config.retryOnError) {
                console.log(req.headers.host + ': Retry limit reached (' + this.config.retryOnError + '), aborting.');
                return this.errorMessage(res, 'Reached max retries limit', 502);
            }
            return this.errorMessage(req, res, 'Retry on error is disabled', 502);
        }

        req.emit('retry');
    }

    startHandler(req, res) {
        let remoteAddr = this.getRemoteAddress(req);


        req.connection.setTimeout(this.config.tcpTimeout * 1000);

        if (req.connection.listeners('timeout').length < 2) {
            req.connection.once('timeout', function () {
                req.error = 'TCP timeout';
            });
        }


        if (remoteAddr === null) {
            return this.errorMessage(req, res, 'Cannot read the remote address.');
        }
        remoteAddr = remoteAddr.replace(/^::ffff:/, '');

        if (req.headers['x-forwarded-for'] === undefined) {
            req.headers['x-forwarded-for'] = remoteAddr;
        }
        if (req.headers['x-real-ip'] === undefined) {
            req.headers['x-real-ip'] = remoteAddr;
        }
        if (req.headers['x-forwarded-protocol'] === undefined) {
            req.headers['x-forwarded-protocol'] = req.connection.pair ? 'https' : 'http';
        }
        if (req.headers['x-forwarded-proto'] === undefined) {
            req.headers['x-forwarded-proto'] = req.connection.pair ? 'https' : 'http';
        }
        if (req.headers['x-forwarded-port'] === undefined) {
            // FIXME: replace by the real port instead of hardcoding it
            req.headers['x-forwarded-port'] = req.connection.pair ? '443' : '80';
        }
    }

    getRemoteAddress(req) {
        if (req.connection === undefined) {
            return null;
        }
        if (req.connection.remoteAddress) {
            return req.connection.remoteAddress;
        }
        if (req.connection.socket && req.connection.socket.remoteAddress) {
            return req.connection.socket.remoteAddress;
        }
        return null;
    }

    async httpRequestHandler(req, res) {
        let start = Date.now();
        let backend;

        req.meta = new Meta({
            metricSession: this.config.metricSession,
            logSession: this.config.logSession,
            frontend: req.headers.host
        });

        this.patchResponse(req, res);


        try {
            backend = await this.cache.getBackendFromHostHeader(req.headers.host);
        } catch (err) {
            return this.errorMessage(req, res, err.message, err.code)
        }
        req.meta.load(backend)


        req.meta.timer.start = start;

        if (!req.connection.stats) {
            this.statsPoll(req);
        }


        //this.patchResponse(req, res);
        this.proxyRequest(req, res);

    }

    async wsRequestHandler(req, socket, head) {
        let backend;
        try {
            backend = await this.cache.getBackendFromHostHeader(req.headers.host);
        } catch (err) {
            console.log('proxyWebSocketRequest: ' + err);
            return;
        }
        this.proxy.ws(req, socket, head, {
            target: {
                host: backend.host,
                port: backend.port
            }
        });
    }

    tcpConnectionHandler(connection) {
        let remoteAddress = connection.remoteAddress;
        let remotePort = connection.remotePort;
        let start = Date.now();


        var getSocketInfo = function () {
            return JSON.stringify({
                remoteAddress: remoteAddress,
                remotePort: remotePort,
                bytesWritten: connection.bytesWritten,
                bytesRead: connection.bytesRead,
                elapsed: (Date.now() - start) / 1000
            });
        };

        connection.setKeepAlive(this.config.httpKeepAlive);
        connection.setTimeout(this.config.tcpTimeout * 1000);
        connection.on('error', function (error) {
            console.log('TCP error from ' + getSocketInfo() + '; Error: ' + JSON.stringify(error));
        });
        connection.on('timeout', function () {
            console.log('TCP timeout from ' + getSocketInfo());
            connection.destroy();
        });
    }

    proxyRequest(req, res) {

        req.meta.timer.startBackend = Date.now();

        this.proxy.emit('start', req, res);
        this.proxy.web(req, res, {
            target: {
                host: req.meta.host,
                port: req.meta.port
            },
            xfwd: false
        });
    }

    patchResponse(req, res) {

        res.debug = (req.headers['x-debug'] !== undefined);

        let self = this;
        let resWriteHead = res.writeHead;
        let resEnd = res.end;

        res.writeHead = function (statusCode) {
            if (res.sentHeaders === true) {
                return;
            }

            res.sentHeaders = true;
            req.meta.timer.head = Date.now();

            let markDeadBackend = function () {
                let backendId = req.meta.id;
                if (req.meta.index > 1) {
                    self.cache.markDeadBackend(req.meta);
                }
                console.log(req.headers.host + ': backend #' + backendId + ' is dead (HTTP error code ' +
                    statusCode + ') while handling request for ' + req.url);
            };


            let startErrorCode = (self.config.deadBackendOn500 === true) ? 500 : 501;

            if ((statusCode >= startErrorCode && statusCode < 600) && res.errorMessage !== true) {
                if (statusCode === 503) {
                    var headers = arguments[arguments.length - 1];
                    if (typeof headers === 'object') {
                        // Let's lookup the headers to find a "Retry-After"
                        // In this case, this is a legit maintenance mode
                        if (headers['retry-after'] === undefined) {
                            markDeadBackend();
                        }
                    }
                } else {
                    // For all other cases, mark the backend as dead
                    markDeadBackend();
                }
            }
            // If debug is enabled, let's inject the debug headers
            if (res.debug === true) {
                //res.setHeader('x-debug-version', balancerVersion);
                res.setHeader('x-debug-backend-url', req.meta.url);
                res.setHeader('x-debug-backend-id', req.meta.id);
                res.setHeader('x-debug-vhost', req.meta.virtualHost);
                res.setHeader('x-debug-frontend-key', req.meta.frontend);
                res.setHeader('x-debug-time-total', (req.meta.timer.end - req.meta.timer.start));
                res.setHeader('x-debug-time-backend', (req.meta.timer.end - req.meta.timer.startBackend));
            }
            return resWriteHead.apply(res, arguments);
        };


        res.end = function () {
            resEnd.apply(res, arguments);

            let socketBytesWritten = req.connection ? req.connection.bytesWritten : 0;

            if (req.meta === undefined) {
                return console.log('Nothing to log'); // Nothing to log
            } else if (req.headers['x-real-ip'] === undefined) {
                self.startHandler(req, res);
            }
            req.meta.timer.end = Date.now();
            // Log the request

            self.accessLog.log({
                remoteAddr: req.headers['x-real-ip'],
                currentTime: req.meta.timer.start,
                totalTimeSpent: (req.meta.timer.end - req.meta.timer.start),
                backendTimeSpent: (req.meta.timer.end - req.meta.timer.startBackend),
                method: req.method,
                url: req.url,
                name: req.meta.name,
                httpVersion: req.httpVersion,
                statusCode: res.statusCode,
                socketBytesWritten: socketBytesWritten,
                referer: req.headers.referer,
                userAgent: req.headers['user-agent'],
                backendUrl: req.meta.url,
                session: req.meta.logSession
            });

            let metrics = {
                total: (req.meta.timer.end - req.meta.timer.start),
                backend: (req.meta.timer.end - req.meta.timer.startBackend),
                statusCode: res.statusCode,
                name: req.meta.name,
                virtualHost: req.meta.virtualHost,
                frontend: req.meta.frontend,
                session: req.meta.metricSession,
            };
            metrics.connect = (metrics.total - metrics.backend);
            self.metrics.sendRequest(metrics);

        };
    }

    statsPoll(req) {

        let self = this;

        req.connection.stats = {
            bytesRead: 0,
            bytesWritten: 0,
            timmer: 0
        };

        function onExit() {
            req.connection.removeListener('close', onExit);
            req.connection.removeListener('end', onExit);
            req.connection.removeListener('timeout', onExit);

            self.metrics.sendConnection({
                virtualHost: req.meta.virtualHost,
                frontend: req.meta.frontend,
                session: req.meta.metricSession,
                bytesRead: req.connection.bytesRead - req.connection.stats.bytesRead,
                bytesWritten: req.connection.bytesWritten - req.connection.stats.bytesWritten,
            });
            clearInterval(req.connection.stats.timmer);
        }

        req.connection.on('close', onExit);
        req.connection.on('end', onExit);
        req.connection.on('timeout', onExit);
        req.connection.stats.timmer = setInterval(function () {

            self.pubsub.emit('stats.' + req.meta.metricSession + '.connection', {
                virtualHost: req.meta.virtualHost,
                frontend: req.meta.frontend,
                session: req.meta.metricSession,
                bytesRead: req.connection.bytesRead - req.connection.stats.bytesRead,
                bytesWritten: req.connection.bytesWritten - req.connection.stats.bytesWritten,
            });
            req.connection.stats.bytesRead = req.connection.bytesRead;
            req.connection.stats.bytesWritten = req.connection.bytesWritten;
        }, 1000);
    }


    errorMessage(req, res, message, code) {

        req.meta.timer.startBackend = Date.now();


        var headers = {
            'content-length': message.length,
            'content-type': 'text/plain',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'expires': '-1'
        };
        res.writeHead(code, headers);
        res.write(message);
        res.end();
    }

}


module.exports = Worker;