#!/usr/bin/env node
const cluster = require('cluster');
const Master = require('../lib/master')
const Worker = require('../lib/worker')


const config = require(require('path').resolve(process.argv[2]));

if (cluster.isMaster) {
    // Run the master
    new Master(config);
} else {
    // Run the worker
    new Worker(config);
}