/**
 * HTTP hook server for Claude Code integration.
 *
 * Port of clawd-on-desk's server.js.
 *
 * Listens on 127.0.0.1 with port auto-discovery (18789-18799).
 * Routes:
 *   GET  /state      — health check
 *   POST /state      — receive agent hook events
 *   POST /permission — receive permission requests
 *
 * Writes the bound port to /tmp/ciallo-runtime.json for hook scripts to discover.
 */

const http = require('http');
const fs = require('fs');

const RUNTIME_FILE = '/tmp/ciallo-runtime.json';
const PORT_MIN = 18789;
const PORT_MAX = 18799;
const MAX_BODY_SIZE = 16384; // 16 KB
const MAX_STRING_LENGTH = 4096;
const MAX_ID_LENGTH = 128;
const MAX_DATA_DEPTH = 8;
const VALID_LEVELS = ['info', 'warn', 'error', 'debug', 'trace'];

// ──────────────────────────────────────────────
//  Input validation helpers
// ──────────────────────────────────────────────

/** Return true if val is a non-empty string within length bounds. */
function isString(val, maxLen) {
  return typeof val === 'string' && val.length > 0 && val.length <= maxLen;
}

/** Return true if val matches a safe identifier character set. */
function isSafeIdentifier(val) {
  return isString(val, MAX_ID_LENGTH) && /^[a-zA-Z0-9_.@\-]+$/.test(val);
}

/** Return true if val is a positive integer < 2^31. */
function isPosInt(val) {
  return typeof val === 'number' && Number.isInteger(val) && val > 0 && val < 2147483648;
}

/** Strip null bytes and control characters (preserve \t \n \r). */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Recursively walk an object value and cap string lengths / nesting depth.
 * Returns a new deep-cloned object.
 */
function sanitizeData(val, depth) {
  if (depth > MAX_DATA_DEPTH) return '[truncated]';
  if (typeof val === 'string') return sanitize(val).slice(0, MAX_STRING_LENGTH);
  if (typeof val === 'number' && !Number.isFinite(val)) return 0;
  if (typeof val === 'boolean' || val === null) return val;
  if (Array.isArray(val)) {
    return val.slice(0, 256).map(function (v) { return sanitizeData(v, depth + 1); });
  }
  if (typeof val === 'object' && val !== null) {
    var out = {};
    var keys = Object.keys(val).slice(0, 64);
    for (var i = 0; i < keys.length; i++) {
      var k = sanitize(keys[i]).slice(0, 128);
      if (k) out[k] = sanitizeData(val[keys[i]], depth + 1);
    }
    return out;
  }
  return String(val).slice(0, MAX_STRING_LENGTH);
}

// ──────────────────────────────────────────────
//  Agent identity resolution
// ──────────────────────────────────────────────

function resolveAgentIdentity(body) {
  var identity = {
    agentId: null,
    sourcePid: null,
    source: 'unknown'
  };

  if (body.agent_id && typeof body.agent_id === 'string') {
    identity.agentId = sanitize(body.agent_id).slice(0, MAX_ID_LENGTH);
  }

  if (body.source_pid !== undefined && body.source_pid !== null) {
    var pid = Number(body.source_pid);
    if (isPosInt(pid)) {
      identity.sourcePid = pid;
    }
  }

  if (body.source && typeof body.source === 'string') {
    identity.source = sanitize(body.source).slice(0, 64);
  }

  return identity;
}

// ──────────────────────────────────────────────
//  Validation — state event
// ──────────────────────────────────────────────

function validateStateEvent(body) {
  var errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be a JSON object'] };
  }

  var event = {};

  // type :: required
  if (!body.type || typeof body.type !== 'string') {
    errors.push('Missing or invalid required field: type (string)');
  } else if (body.type.length > 64) {
    errors.push('Field type exceeds maximum length of 64 characters');
  } else {
    event.type = body.type;
  }

  // agent_id :: optional safe identifier
  if (body.agent_id !== undefined) {
    if (typeof body.agent_id !== 'string') {
      errors.push('Invalid field: agent_id must be a string');
    } else if (body.agent_id.length > MAX_ID_LENGTH) {
      errors.push('Field agent_id exceeds maximum length of ' + MAX_ID_LENGTH);
    } else if (!/^[a-zA-Z0-9_.@\-]+$/.test(body.agent_id)) {
      errors.push('Invalid field: agent_id contains disallowed characters');
    } else {
      event.agentId = body.agent_id;
    }
  }

  // source_pid :: optional positive integer
  if (body.source_pid !== undefined && body.source_pid !== null) {
    var pid = Number(body.source_pid);
    if (!isPosInt(pid)) {
      errors.push('Invalid field: source_pid must be a positive integer');
    } else {
      event.sourcePid = pid;
    }
  }

  // message :: optional string
  if (body.message !== undefined) {
    if (typeof body.message !== 'string') {
      errors.push('Invalid field: message must be a string');
    } else if (body.message.length > MAX_STRING_LENGTH) {
      errors.push('Field message exceeds maximum length of ' + MAX_STRING_LENGTH);
    } else {
      event.message = sanitize(body.message);
    }
  }

  // level :: optional one-of
  if (body.level !== undefined) {
    if (typeof body.level !== 'string') {
      errors.push('Invalid field: level must be a string');
    } else if (VALID_LEVELS.indexOf(body.level) === -1) {
      errors.push('Invalid field: level must be one of: ' + VALID_LEVELS.join(', '));
    } else {
      event.level = body.level;
    }
  }

  // timestamp :: optional positive number
  if (body.timestamp !== undefined && body.timestamp !== null) {
    var ts = Number(body.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) {
      errors.push('Invalid field: timestamp must be a positive number');
    } else {
      event.timestamp = ts;
    }
  }

  // data :: optional object (sanitised)
  if (body.data !== undefined && body.data !== null) {
    if (typeof body.data !== 'object' || Array.isArray(body.data)) {
      errors.push('Invalid field: data must be a plain object');
    } else {
      event.data = sanitizeData(body.data, 0);
    }
  }

  return { valid: errors.length === 0, event: event, errors: errors };
}

// ──────────────────────────────────────────────
//  Validation — permission request
// ──────────────────────────────────────────────

function validatePermissionRequest(body) {
  var errors = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Body must be a JSON object'] };
  }

  var req = {};

  // id :: required safe identifier
  if (!body.id || typeof body.id !== 'string') {
    errors.push('Missing or invalid required field: id (string)');
  } else if (body.id.length > MAX_ID_LENGTH) {
    errors.push('Field id exceeds maximum length of ' + MAX_ID_LENGTH);
  } else if (!/^[a-zA-Z0-9_.@\-]+$/.test(body.id)) {
    errors.push('Invalid field: id contains disallowed characters');
  } else {
    req.id = body.id;
  }

  // command :: required string
  if (!body.command || typeof body.command !== 'string') {
    errors.push('Missing or invalid required field: command (string)');
  } else if (body.command.length > MAX_STRING_LENGTH) {
    errors.push('Field command exceeds maximum length of ' + MAX_STRING_LENGTH);
  } else {
    req.command = sanitize(body.command);
  }

  // args :: optional array of strings
  if (body.args !== undefined) {
    if (!Array.isArray(body.args)) {
      errors.push('Invalid field: args must be an array');
    } else if (body.args.length > 256) {
      errors.push('Field args exceeds maximum of 256 items');
    } else {
      req.args = [];
      for (var i = 0; i < body.args.length; i++) {
        var a = body.args[i];
        req.args.push(
          typeof a === 'string'
            ? sanitize(a).slice(0, 1024)
            : String(a).slice(0, 1024)
        );
      }
    }
  }

  // cwd :: optional string
  if (body.cwd !== undefined) {
    if (typeof body.cwd !== 'string') {
      errors.push('Invalid field: cwd must be a string');
    } else if (body.cwd.length > 1024) {
      errors.push('Field cwd exceeds maximum length of 1024 characters');
    } else {
      req.cwd = sanitize(body.cwd);
    }
  }

  // source :: optional string
  if (body.source !== undefined) {
    if (typeof body.source !== 'string') {
      errors.push('Invalid field: source must be a string');
    } else if (body.source.length > 64) {
      errors.push('Field source exceeds maximum length of 64 characters');
    } else {
      req.source = sanitize(body.source);
    }
  }

  // timestamp :: optional positive number
  if (body.timestamp !== undefined && body.timestamp !== null) {
    var ts = Number(body.timestamp);
    if (!Number.isFinite(ts) || ts <= 0) {
      errors.push('Invalid field: timestamp must be a positive number');
    } else {
      req.timestamp = ts;
    }
  }

  return { valid: errors.length === 0, req: req, errors: errors };
}

// ──────────────────────────────────────────────
//  Server factory
// ──────────────────────────────────────────────

/**
 * Create an HTTP hook server.
 *
 * @param {object} ctx
 * @param {function} ctx.onStateEvent   — called with validated event object
 * @param {function} ctx.onPermissionRequest — called with validated permission request
 * @param {function} ctx.log            — logging function(string)
 * @returns {{ start: function, stop: function, getPort: function }}
 */
function createHookServer(ctx) {
  var server = null;
  var activePort = null;

  // Guard required ctx members
  if (!ctx || typeof ctx.onStateEvent !== 'function') {
    throw new TypeError('createHookServer requires ctx.onStateEvent function');
  }
  if (typeof ctx.onPermissionRequest !== 'function') {
    throw new TypeError('createHookServer requires ctx.onPermissionRequest function');
  }
  if (typeof ctx.log !== 'function') {
    ctx.log = function () {}; // no-op fallback
  }

  // ── Response helpers ────────────────────────

  function respondJSON(res, statusCode, data, extraHeaders) {
    var body = JSON.stringify(data);
    var headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff'
    };

    // Tag responses with server header
    if (data && data.ok) {
      headers['x-ciallo-server'] = 'ciallo-for-desktop';
    }

    if (extraHeaders && typeof extraHeaders === 'object') {
      var keys = Object.keys(extraHeaders);
      for (var i = 0; i < keys.length; i++) {
        headers[keys[i]] = extraHeaders[keys[i]];
      }
    }

    res.writeHead(statusCode, headers);
    res.end(body);
  }

  function jsonError(res, statusCode, msg, details) {
    var payload = { error: msg, ok: false };
    if (details) payload.details = details;
    respondJSON(res, statusCode, payload);
  }

  // ── Body parser ─────────────────────────────

  function parseBody(req, res, cb) {
    var chunks = [];
    var totalBytes = 0;
    var aborted = false;

    req.on('data', function onData(chunk) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_SIZE && !aborted) {
        aborted = true;
        req.destroy();
        try {
          jsonError(res, 413, 'Request body too large (max ' + MAX_BODY_SIZE + ' bytes)');
        } catch (_) { /* socket may already be gone */ }
        return;
      }
      if (!aborted) {
        chunks.push(chunk);
      }
    });

    req.on('end', function onEnd() {
      if (aborted) return;

      if (chunks.length === 0) {
        jsonError(res, 400, 'Empty request body');
        return;
      }

      var bodyStr = Buffer.concat(chunks).toString('utf-8');

      if (!bodyStr || bodyStr.trim().length === 0) {
        jsonError(res, 400, 'Empty request body');
        return;
      }

      try {
        var body = JSON.parse(bodyStr);
        cb(body);
      } catch (parseErr) {
        jsonError(res, 400, 'Invalid JSON in request body');
      }
    });

    req.on('error', function onReqError() {
      if (!res.headersSent) {
        try { jsonError(res, 500, 'Internal server error'); } catch (_) {}
      }
    });
  }

  // ── Route handlers ──────────────────────────

  function handleGetState(req, res) {
    var payload = {
      ok: true,
      app: 'ciallo-for-desktop',
      port: activePort
    };
    respondJSON(res, 200, payload);
  }

  function handlePostState(req, res) {
    parseBody(req, res, function (body) {
      var validation = validateStateEvent(body);

      if (!validation.valid) {
        ctx.log(
          '[server.js] State event validation failed: ' +
          validation.errors.join('; ')
        );
        jsonError(res, 400, 'Validation failed', validation.errors);
        return;
      }

      var identity = resolveAgentIdentity(body);
      var event = validation.event;
      event.identity = identity;
      event.ts = event.timestamp || Date.now();

      try {
        ctx.onStateEvent(event);
        respondJSON(res, 200, { ok: true });
      } catch (err) {
        ctx.log('[server.js] onStateEvent error: ' + (err.message || err));
        // Return 200 to avoid hook retry loops
        respondJSON(res, 200, { ok: true });
      }
    });
  }

  function handlePostPermission(req, res) {
    parseBody(req, res, function (body) {
      var validation = validatePermissionRequest(body);

      if (!validation.valid) {
        ctx.log(
          '[server.js] Permission request validation failed: ' +
          validation.errors.join('; ')
        );
        jsonError(res, 400, 'Validation failed', validation.errors);
        return;
      }

      try {
        ctx.onPermissionRequest(validation.req);
        respondJSON(res, 200, { ok: true });
      } catch (err) {
        ctx.log('[server.js] onPermissionRequest error: ' + (err.message || err));
        respondJSON(res, 200, { ok: true });
      }
    });
  }

  function handleNotFound(req, res) {
    jsonError(res, 404, 'Not found');
  }

  // ── Request router ──────────────────────────

  function handleRequest(req, res) {
    var method = req.method.toUpperCase();
    var url = req.url;

    ctx.log('[server.js] ' + method + ' ' + url);

    if (method === 'GET' && url === '/state') {
      handleGetState(req, res);
    } else if (method === 'POST' && url === '/state') {
      handlePostState(req, res);
    } else if (method === 'POST' && url === '/permission') {
      handlePostPermission(req, res);
    } else {
      handleNotFound(req, res);
    }
  }

  // ── Runtime file ────────────────────────────

  function writeRuntimeFile(port) {
    var data = JSON.stringify(
      {
        pid: process.pid,
        port: port,
        app: 'ciallo-for-desktop',
        startedAt: new Date().toISOString()
      },
      null,
      2
    );

    try {
      fs.writeFileSync(RUNTIME_FILE, data, 'utf-8');
      ctx.log('[server.js] Runtime file written to ' + RUNTIME_FILE);
    } catch (err) {
      ctx.log('[server.js] Warning: could not write runtime file: ' + err.message);
    }
  }

  function removeRuntimeFile() {
    try {
      if (fs.existsSync(RUNTIME_FILE)) {
        fs.unlinkSync(RUNTIME_FILE);
        ctx.log('[server.js] Runtime file removed: ' + RUNTIME_FILE);
      }
    } catch (err) {
      ctx.log('[server.js] Warning: could not remove runtime file: ' + err.message);
    }
  }

  // ── Port discovery ──────────────────────────

  /**
   * Probe whether `port` is free on 127.0.0.1.
   * Calls cb(null) if in use, cb(port) if free, cb(Error) on failure.
   */
  function tryBind(port, cb) {
    var probe = http.createServer();

    var done = false;
    function once(err, result) {
      if (done) return;
      done = true;
      cb(err, result);
    }

    probe.once('error', function (err) {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        once(null, null); // not available
      } else {
        once(err);
      }
    });

    probe.once('listening', function () {
      probe.close(function () {
        once(null, port); // free
      });
    });

    probe.listen(port, '127.0.0.1');
  }

  // ── Public API ──────────────────────────────

  function start(done) {
    if (server) {
      var alreadyErr = new Error('Hook server is already running on port ' + activePort);
      if (typeof done === 'function') {
        done(alreadyErr);
        return;
      }
      throw alreadyErr;
    }

    function tryPorts(idx) {
      if (idx > PORT_MAX) {
        var exhaustionErr = new Error(
          'Could not find an available port in range ' +
          PORT_MIN + '-' + PORT_MAX
        );
        ctx.log('[server.js] ' + exhaustionErr.message);
        if (typeof done === 'function') done(exhaustionErr);
        return;
      }

      tryBind(idx, function (err, result) {
        if (err) {
          ctx.log('[server.js] Port probe error on ' + idx + ': ' + err.message);
          if (typeof done === 'function') done(err);
          return;
        }

        if (result === null) {
          // Port in use, try next
          ctx.log('[server.js] Port ' + idx + ' in use, trying ' + (idx + 1));
          tryPorts(idx + 1);
          return;
        }

        // Free port acquired — start the actual server
        activePort = result;
        server = http.createServer(handleRequest);

        // Absorb connection errors so a single bad request doesn't crash
        server.on('error', function (err) {
          ctx.log('[server.js] Server error: ' + err.message);
        });

        // Handle malformed HTTP requests at the socket level
        server.on('clientError', function (err, socket) {
          ctx.log('[server.js] Client error: ' + err.message);
          if (socket.writable && !socket.destroyed) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
          }
        });

        server.listen(activePort, '127.0.0.1', function () {
          ctx.log(
            '[server.js] Hook server listening on http://127.0.0.1:' + activePort
          );
          writeRuntimeFile(activePort);
          if (typeof done === 'function') done(null, activePort);
        });
      });
    }

    tryPorts(PORT_MIN);
  }

  function stop() {
    if (!server) {
      ctx.log('[server.js] Hook server is not running');
      return;
    }

    removeRuntimeFile();

    var s = server;
    server = null;
    activePort = null;

    s.close(function (err) {
      if (err) {
        ctx.log('[server.js] Error stopping server: ' + err.message);
      } else {
        ctx.log('[server.js] Hook server stopped');
      }
    });
  }

  function getPort() {
    return activePort;
  }

  return { start: start, stop: stop, getPort: getPort };
}

module.exports = { createHookServer: createHookServer };
