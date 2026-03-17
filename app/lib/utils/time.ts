// @ts-nocheck
function nowIso() {
  return new Date().toISOString();
}

function addSeconds(isoOrDate, seconds) {
  const d = isoOrDate instanceof Date ? new Date(isoOrDate) : new Date(isoOrDate);
  d.setSeconds(d.getSeconds() + seconds);
  return d.toISOString();
}

function isExpired(expiresAt, now = new Date()) {
  return new Date(expiresAt).getTime() <= now.getTime();
}

module.exports = { nowIso, addSeconds, isExpired };
