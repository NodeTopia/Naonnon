

const http = require('http');

const hostname = '127.0.0.1';
const port = 8083;

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    //setTimeout(function(){
        res.end('Hello World\n');
    //},Math.floor(Math.random()*100) + 1)
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});