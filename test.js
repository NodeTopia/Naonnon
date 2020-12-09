const Proxy = require('./lib/proxy')

let proxy = new Proxy({});

proxy.use((req, res) => {

    req.meta = {
        timer: {
            start: Date.now(),
            head: 0,
            connect: 0,
            hostStart: 0,
            hostStop: 0,
        }
    }
}, 'patch');

proxy.use((req, res) => {
    req.meta.timer.hostStart = Date.now();
}, 'proxy');
proxy.use((req, res) => {
    req.meta.timer.hostStart = Date.now();
}, 'end');

proxy.use((req, res) => {
    req.meta.timer.head = Date.now();
}, 'writeHead');





proxy.use(async (req, res) => {
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
    if (true || res.debug === true) {
        //res.setHeader('x-debug-version', balancerVersion);
        res.setHeader('x-debug-backend-url', req.meta.url);
        res.setHeader('x-debug-backend-id', req.meta.id);
        res.setHeader('x-debug-vhost', req.meta.virtualHost);
        res.setHeader('x-debug-frontend-key', req.meta.frontend);
        res.setHeader('x-debug-time-total', (req.meta.timer.end - req.meta.timer.start));
        res.setHeader('x-debug-time-backend', (req.meta.timer.end - req.meta.timer.startBackend));
    }
}, 'request')