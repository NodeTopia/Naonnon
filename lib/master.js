const cluster = require('cluster');
const EventEmitter = require('events').EventEmitter;

class Master extends EventEmitter {
    constructor(config) {
        super();

        this.config = config;
        this.spawnWorkers(this.config.workers);
    }

    spawnWorker() {
        let self = this;
        let worker = cluster.fork();
    }

    spawnWorkers(number) {
        let self = this;

        // Spawn all workers
        for (var n = 0; n < number; n += 1) {
            console.log('Spawning worker #' + n);
            this.spawnWorker();
        }
        cluster.on('exit', function (worker, code, signal) {
            var m = 'Worker died (pid: ' + worker.process.pid + ', suicide: ' + (worker.suicide === undefined ? 'false' : worker.suicide.toString());
            if (worker.suicide === false) {
                if (code !== null) {
                    m += ', exitcode: ' + code;
                }
                if (signal !== null) {
                    m += ', signal: ' + signal;
                }
            }
            m += '). Spawning a new one.';
            console.log(m);
            self.spawnWorker();
        });
        // Set an exit handler
        var onExit = function () {
            this.emit('exit');
            console.log('Exiting, killing the workers');
            for (var id in cluster.workers) {
                var worker = cluster.workers[id];
                console.log('Killing worker #' + worker.process.pid);
                worker.destroy();
            }
            process.exit(0);
        }.bind(this);
        process.on('SIGINT', onExit);
        process.on('SIGTERM', onExit);
    }
}

module.exports = Master;