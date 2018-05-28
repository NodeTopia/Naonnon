const dgram = require('dgram');

class Metrics {
    constructor(config) {
        this.config = config;
        this.socket = dgram.createSocket('udp4');
        this.timmer = setInterval(this.flush.bind(this), config.flush || 1000)
        this.metrics = '';
    }

    close() {
        this.flush();
        clearInterval(this.timmer)
    }

    flush() {
        if (this.metrics.length === 0) {
            return;
        }
        let buf = Buffer.from(this.metrics, 'utf8');
        this.socket.send(buf, 0, buf.length, this.config.port, this.config.host);
        this.metrics = '';
    }

    append(string) {
        if (Buffer.byteLength(this.metrics, 'utf8') > (this.config.packet || 1432)) {
            this.flush();
        } else if (Buffer.byteLength(this.metrics + string, 'utf8') > (this.config.packet || 1432)) {
            this.flush();
        }
        this.metrics += string;
    }

    sendConnection(data) {
        let session = 'http.' + data.session + '.' + data.frontend.replace(/\./g, '_');

        this.append(session + '.bytesWritten:' + data.bytesWritten + '|c\n');
        this.append(session + '.bytesRead:' + data.bytesRead + '|c\n');
        this.append(session + '.bytesTotal:' + data.bytesRead + data.bytesWritten + '|c\n');
    }

    sendRequest(data) {
        let session = 'http.' + data.session + '.' + data.frontend.replace(/\./g, '_');

        this.append(session + '.total:' + data.total + '|ms\n');
        this.append(session + '.backend:' + data.backend + '|ms\n');
        this.append(session + '.connect:' + data.connect + '|ms\n');
        this.append(session + ':1|c\n');
        this.append(session + '.status.' + data.statusCode + ':1|c\n');

    }
}

module.exports = Metrics;