/**
 * hooks/server-config.js — Hook server configuration & HTTP helpers
 *
 * Ported from clawd-on-desk's hooks/server-config.js.
 * Helps hook scripts discover the running CialloForDesktop server port.
 *
 * @module hooks/server-config
 */

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const CIALLO_SERVER_ID = 'ciallo-for-desktop';
const CIALLO_SERVER_HEADER = 'x-ciallo-server';
const DEFAULT_SERVER_PORT = 23333;
const SERVER_PORT_COUNT = 5;
const SERVER_PORTS = Array.from({ length: SERVER_PORT_COUNT }, function (_, i) { return DEFAULT_SERVER_PORT + i; });
const STATE_PATH = '/state';
const PERMISSION_PATH = '/permission';
const RUNTIME_CONFIG_PATH = path.join(os.homedir(), '.ciallo', 'runtime.json');
const DEFAULT_HOOK_HTTP_TIMEOUT_MS = 100;

function normalizePort(value) {
  var port = Number(value);
  return Number.isInteger(port) && port >= 18789 && port <= 18799 ? port : null;
}

function readRuntimeConfig() {
  try {
    var raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    var port = normalizePort(raw.port);
    return port ? { port: port } : null;
  } catch (e) {
    return null;
  }
}

function readRuntimePort() {
  var config = readRuntimeConfig();
  return config ? config.port : null;
}

function writeRuntimeConfig(port) {
  var safePort = normalizePort(port);
  if (!safePort) return false;

  var dir = path.dirname(RUNTIME_CONFIG_PATH);
  var tmpPath = path.join(dir, '.runtime.' + process.pid + '.' + Date.now() + '.tmp');
  var body = JSON.stringify({ app: CIALLO_SERVER_ID, port: safePort }, null, 2);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, body, 'utf8');
    fs.renameSync(tmpPath, RUNTIME_CONFIG_PATH);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (e2) {}
    return false;
  }
}

function clearRuntimeConfig() {
  try {
    fs.unlinkSync(RUNTIME_CONFIG_PATH);
    return true;
  } catch (e) {
    return false;
  }
}

function getPortCandidates(preferredPort, runtimePort) {
  var ports = [];
  var seen = new Set();

  function add(value) {
    var port = normalizePort(value);
    if (!port || seen.has(port)) return;
    seen.add(port);
    ports.push(port);
  }

  if (typeof preferredPort === 'number') add(preferredPort);
  else if (Array.isArray(preferredPort)) preferredPort.forEach(add);

  if (runtimePort === undefined) runtimePort = readRuntimePort();
  add(runtimePort);

  SERVER_PORTS.forEach(add);
  return ports;
}

function probePort(port, timeoutMs, callback) {
  var req = http.get(
    { hostname: '127.0.0.1', port: port, path: STATE_PATH, timeout: timeoutMs },
    function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        if (body.length < 256) body += chunk;
      });
      res.on('end', function () {
        var isCiallo = res.headers[CIALLO_SERVER_HEADER] === CIALLO_SERVER_ID;
        if (!isCiallo && body) {
          try {
            var data = JSON.parse(body);
            isCiallo = data && data.app === CIALLO_SERVER_ID;
          } catch (e) {}
        }
        callback(isCiallo);
      });
    }
  );

  req.on('error', function () { callback(false); });
  req.on('timeout', function () {
    req.destroy();
    callback(false);
  });
}

function postStateToPort(port, payload, timeoutMs, callback) {
  var req = http.request(
    {
      hostname: '127.0.0.1',
      port: port,
      path: STATE_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    },
    function (res) {
      res.resume();
      var isCiallo = res.headers[CIALLO_SERVER_HEADER] === CIALLO_SERVER_ID;
      if (!isCiallo) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { body += chunk; });
        res.on('end', function () {
          try {
            var data = JSON.parse(body);
            isCiallo = data && data.app === CIALLO_SERVER_ID;
          } catch (e) {}
          callback(isCiallo, port);
        });
      } else {
        callback(true, port);
      }
    }
  );

  req.on('error', function () { callback(false, port); });
  req.on('timeout', function () {
    req.destroy();
    callback(false, port);
  });
  req.end(payload);
}

function discoverCialloPort(options, callback) {
  var timeoutMs = (options && options.timeoutMs) || DEFAULT_HOOK_HTTP_TIMEOUT_MS;
  var ports = getPortCandidates(options && options.preferredPort);
  var index = 0;

  function tryNext() {
    if (index >= ports.length) {
      callback(null);
      return;
    }
    var port = ports[index++];
    probePort(port, timeoutMs, function (ok) {
      if (ok) { callback(port); return; }
      tryNext();
    });
  }
  tryNext();
}

function postStateToRunningServer(body, options, callback) {
  var timeoutMs = (options && options.timeoutMs) || DEFAULT_HOOK_HTTP_TIMEOUT_MS;
  var payload = typeof body === 'string' ? body : JSON.stringify(body);
  var ports = getPortCandidates(options && options.preferredPort);
  var index = 0;

  function tryNext() {
    if (index >= ports.length) {
      callback(false, null);
      return;
    }
    var port = ports[index++];
    probePort(port, timeoutMs, function (ok) {
      if (!ok) { tryNext(); return; }
      postStateToPort(port, payload, timeoutMs, function (posted) {
        if (posted) { callback(true, port); return; }
        tryNext();
      });
    });
  }
  tryNext();
}

module.exports = {
  CIALLO_SERVER_HEADER,
  CIALLO_SERVER_ID,
  DEFAULT_HOOK_HTTP_TIMEOUT_MS,
  DEFAULT_SERVER_PORT,
  PERMISSION_PATH,
  RUNTIME_CONFIG_PATH,
  SERVER_PORTS,
  STATE_PATH,
  clearRuntimeConfig,
  discoverCialloPort,
  getPortCandidates,
  postStateToPort,
  postStateToRunningServer,
  probePort,
  readRuntimePort,
  writeRuntimeConfig,
};
