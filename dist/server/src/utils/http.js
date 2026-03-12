"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const fs = require('node:fs');
const path = require('node:path');
const mimeByExt = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml'
};
function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
    });
    res.end(body);
}
function sendText(res, statusCode, text) {
    res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
}
function sendFile(res, filePath) {
    if (!fs.existsSync(filePath))
        return false;
    const ext = path.extname(filePath).toLowerCase();
    const mime = mimeByExt[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
        'content-type': mime,
        'content-length': content.length,
        'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(content);
    return true;
}
function parseJsonBody(req, { maxBytes = 262144 } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;
        const fail = (err) => {
            if (done)
                return;
            done = true;
            reject(err);
            req.destroy();
        };
        req.on('data', (chunk) => {
            if (done)
                return;
            total += chunk.length;
            if (total > maxBytes) {
                fail(new Error('Request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (done)
                return;
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw)
                return resolve({});
            try {
                done = true;
                resolve(JSON.parse(raw));
            }
            catch (err) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', (err) => {
            if (done)
                return;
            reject(err);
        });
    });
}
module.exports = { sendJson, sendText, sendFile, parseJsonBody };
