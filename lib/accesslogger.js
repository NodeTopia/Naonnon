(function() {
    'use strict';
    //FIXME,convert to class
    var fs = require('fs'),
        util = require('util'),
        EventEmitter = require('events').EventEmitter;

    var Logger = require('raft-logger-redis').Logger;

    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var addDigit = function(n) {
        if (n < 10) {
            return '0' + n;
        }
        return n;
    };

    var AccessLogger = function(config) {

        var logger = Logger.createLogger(config);

        var logs = {};

        var stream;

        var sayErr = ( function(e) {
            process.nextTick( function() {
                this.emit('error', e);
            }.bind(this));
        }.bind(this));

        var start = this.start = function() {

            stream = logger.create({
                source : 'system',
                channel : 'router',
                session : config.session
            });
        };

        var stop = this.stop = function() {
            stream.stop();
        };

        process.on('SIGUSR1', function() {
            // Reload the Stream on signal
            util.log('Caught a SIGUSR1 signal, reopening the log file.');
            stop();
            start();
        });

        try {
            start();
        } catch (e) {
            sayErr(e);
        }

        this._log = function(data) {
            stream.log(data);
        };

        this.log = function(data) {
            var line = 'fwd=',
                date = new Date(data.currentTime);
            // Remote addr
            if (!data.remoteAddr || data.remoteAddr.slice(0, 2) !== '::') {
                //line += '::ffff:';
            }
            line += data.remoteAddr;

            // Request
            line += ' method=';
            line += data.method;
            //Path
            line += ' path=';
            line += data.url;
            // Status code
            line += ' status=';
            line += data.statusCode;
            line += ' bytes=';
            // Bytes sent
            //FIXME, sometimes we cannot read socketBytesWritten (maybe because of a websocket?)
            line += data.socketBytesWritten || 0;
            // Virtual host
            line += ' name=';
            line += data.name;
            // Virtual host
            line += ' host=';
            line += data.backendUrl;
            // Backend time spent
            line += ' backend=';
            line += data.backendTimeSpent + 'ms';
            // Connect time spent
            line += ' connect=';
            // Backend time spent
            line += (data.totalTimeSpent - data.backendTimeSpent) + 'ms';
            line += ' total=';
            // Backend time spent
            line += data.totalTimeSpent + 'ms';

            if (data.session) {

                var name = data.backendUrl;

                if (!logs[name]) {
                    logs[name] = logger.create({
                        source : 'system',
                        channel : 'router',
                        session : data.session,
                        bufferSize : 5
                    });
                    logs[name].t = 0;
                }

                logs[name].write(line + '\n');

                clearTimeout(logs[name].t);
                logs[name].t = setTimeout(function() {
                    logs[name].stop();
                    delete logs[name];
                }, 15 * 60 * 1000);
            }
            stream.write(line + '\n');
        };
    };

    util.inherits(AccessLogger, EventEmitter);

    module.exports = AccessLogger;

})();