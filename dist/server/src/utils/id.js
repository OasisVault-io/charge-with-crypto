"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const crypto = require('node:crypto');
function randomId(prefix = 'id') {
    return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
module.exports = { randomId };
