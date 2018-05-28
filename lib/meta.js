class Meta {
    constructor(config) {
        if (config.frontend) {
            let index = config.frontend.indexOf(':');
            if (index > 0) {
                config.frontend = config.frontend.slice(0, index).toLowerCase();
            }
        }
        this._backend = {
            name: 'noname',
            metricSession: config.metricSession,
            logSession: config.logSession,
            virtualHost: 'error',
            frontend: config.frontend

        };
        this.timer = {start: Date.now()}
    }

    load(backend) {
        this._backend = backend
    }

    get id() {
        return this._backend.id;
    }

    get index() {
        return this._backend.index;
    }

    get name() {
        return this._backend.name;
    }

    get frontend() {
        return this._backend.frontend;
    }

    get host() {
        return this._backend.host;
    }

    get port() {
        return this._backend.port;
    }

    get virtualHost() {
        return this._backend.virtualHost;
    }

    get url() {
        if (this._backend.host && this._backend.port)
            return `http://${this._backend.host}:${this._backend.port}`
        else
            return false
    }

    get metricSession() {
        return this._backend.metricSession
    }

    get logSession() {
        return this._backend.logSession
    }
}

module.exports = Meta;