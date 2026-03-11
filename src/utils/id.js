const crypto = require('node:crypto');

function randomId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = { randomId };
