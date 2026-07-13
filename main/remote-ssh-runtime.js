/**
 * main/remote-ssh-runtime.js — SSH tunnel state machine
 *
 * Manages SSH reverse-forward tunnel lifecycle:
 *   idle -> connecting -> connected | reconnecting | failed
 *
 * Features:
 *   - Per-profile connection state tracking
 *   - Health probing via remote HTTP check (x-ciallo-server header)
 *   - Exponential backoff reconnection with configurable schedule
 *   - Stderr classification for user-friendly error reporting
 *   - Graceful disconnect with resource cleanup
 *
 * @module main/remote-ssh-runtime
 */

'use strict';

const EventEmitter = require('events');
const { spawn } = require('child_process');
const { buildSshArgs } = require('./remote-ssh-quote');

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Valid runtime states. */
const STATES = Object.freeze({
  IDLE:         'idle',
  CONNECTING:   'connecting',
  CONNECTED:    'connected',
  RECONNECTING: 'reconnecting',
  FAILED:       'failed',
  DISCONNECTED: 'disconnected',
});

/** Default backoff schedule (milliseconds). */
const DEFAULT_BACKOFF = [5000, 15000, 45000, 120000, 300000];

/** Maximum consecutive "unknown" errors before marking as failed. */
const MAX_UNKNOWN_STRIKES = 3;

/** Health probe timeout (ms). */
const HEALTH_PROBE_TIMEOUT = 10000;

/** Health probe interval when connected (ms). */
const HEALTH_CHECK_INTERVAL = 30000;

/** Connection stall timeout — transition connecting -> failed if no stderr signal (ms). */
const CONNECT_TIMEOUT = 15000;

// ─── Stderr classification ─────────────────────────────────────────────────────

/**
 * Classify SSH stderr output into user-friendly error categories.
 *
 * @param {string} text - Decoded stderr text
 * @returns {{ category: string, message: string, recoverable: boolean }}
 */
function classifyStderr(text) {
  if (!text || typeof text !== 'string') {
    return { category: 'unknown', message: '', recoverable: false };
  }

  var lower = text.toLowerCase();

  // ── Authentication denied ────────────────────────
  if (
    lower.indexOf('permission denied') >= 0 ||
    lower.indexOf('authentication failed') >= 0 ||
    lower.indexOf('authentication denied') >= 0 ||
    lower.indexOf('password authentication failed') >= 0 ||
    lower.indexOf('no supported authentication methods') >= 0 ||
    lower.indexOf('too many authentication failures') >= 0
  ) {
    return {
      category: 'auth_denied',
      message: 'SSH authentication failed — check your credentials and key permissions',
      recoverable: false,
    };
  }

  // ── Host key issues ──────────────────────────────
  if (
    lower.indexOf('host key verification failed') >= 0 ||
    lower.indexOf('remote host identification has changed') >= 0 ||
    lower.indexOf('no matching host key type') >= 0 ||
    lower.indexOf('host key mismatch') >= 0
  ) {
    return {
      category: 'host_key',
      message: 'SSH host key verification failed — the remote host key may have changed',
      recoverable: true,
    };
  }

  // ── Port forwarding failure ──────────────────────
  if (
    lower.indexOf('forward') >= 0 &&
    (lower.indexOf('fail') >= 0 || lower.indexOf('denied') >= 0 || lower.indexOf('error') >= 0)
  ) {
    return {
      category: 'forward_failed',
      message: 'Remote port forwarding was denied by the server',
      recoverable: true,
    };
  }

  // ── DNS resolution ───────────────────────────────
  if (
    lower.indexOf('could not resolve hostname') >= 0 ||
    lower.indexOf('name or service not known') >= 0 ||
    lower.indexOf('temporary failure in name resolution') >= 0 ||
    lower.indexOf('nodename nor servname provided') >= 0
  ) {
    return {
      category: 'dns',
      message: 'Could not resolve remote hostname — check the host address',
      recoverable: true,
    };
  }

  // ── Connection refused / unreachable ─────────────
  if (
    lower.indexOf('connection refused') >= 0 ||
    lower.indexOf('connection timed out') >= 0 ||
    lower.indexOf('connection closed by remote host') >= 0 ||
    lower.indexOf('connection reset by peer') >= 0 ||
    lower.indexOf('no route to host') >= 0 ||
    lower.indexOf('network is unreachable') >= 0 ||
    lower.indexOf('operation timed out') >= 0
  ) {
    return {
      category: 'connection_refused',
      message: 'Remote host is unreachable — check if the server is online and SSH port is open',
      recoverable: true,
    };
  }

  // ── Broken pipe / unexpected disconnect ──────────
  if (
    lower.indexOf('broken pipe') >= 0 ||
    lower.indexOf('packet_write_wait') >= 0 ||
    lower.indexOf('connection to') >= 0 && lower.indexOf('closed') >= 0 ||
    lower.indexOf('remote host forcibly closed') >= 0 ||
    lower.indexOf('disconnected from') >= 0
  ) {
    return {
      category: 'broken_pipe',
      message: 'SSH connection was lost — the remote server may have restarted or the network dropped',
      recoverable: true,
    };
  }

  // ── ExitOnForwardFailure ─────────────────────────
  if (
    lower.indexOf('exit on forward failure') >= 0
  ) {
    return {
      category: 'forward_failed',
      message: 'Port forwarding stopped — the remote endpoint may no longer be available',
      recoverable: true,
    };
  }

  return {
    category: 'unknown',
    message: text.slice(0, 200),
    recoverable: true,
  };
}

// ─── Runtime Factory ──────────────────────────────────────────────────────────

/**
 * Create an SSH remote runtime instance.
 *
 * Manages multiple SSH tunnel connections, each identified by a profile ID.
 * Emits 'status-changed' on any state transition.
 *
 * @param {object} deps - Dependencies
 * @param {function} deps.log - Logger function (string) => void
 * @param {function} deps.getLocalPort - Get the local hook server port () => number
 * @param {function} [deps.onStatusChange] - Callback on any status change (profileId, status)
 * @returns {object} Runtime API
 */
function createRemoteSshRuntime(deps) {
  if (!deps || typeof deps.log !== 'function') {
    throw new TypeError('createRemoteSshRuntime requires deps.log function');
  }
  if (typeof deps.getLocalPort !== 'function') {
    throw new TypeError('createRemoteSshRuntime requires deps.getLocalPort function');
  }

  var log = deps.log;
  var getLocalPort = deps.getLocalPort;
  var onStatusChange = (typeof deps.onStatusChange === 'function') ? deps.onStatusChange : function () {};

  /** @type {EventEmitter} */
  var emitter = new EventEmitter();

  /**
   * Connection state per profile.
   * Map<profileId, { state, child, timers, backoff, unknownStrikes, stderrBuf, lastError }>
   * @type {Map<string, object>}
   */
  var connections = new Map();

  // ── Internal helpers ─────────────────────────────

  /**
   * Create a default connection state entry.
   *
   * @param {string} profileId
   * @returns {object}
   */
  function createConnectionState(profileId) {
    return {
      profileId: profileId,
      state: STATES.IDLE,
      child: null,               // ChildProcess | null
      timers: {
        connectTimeout: null,
        reconnectTimer: null,
        healthCheckTimer: null,
        healthProbeTimer: null,
      },
      backoff: {
        attempt: 0,
        schedule: DEFAULT_BACKOFF.slice(),
      },
      unknownStrikes: 0,
      stderrBuf: '',
      lastError: '',
      connectedAt: null,
      profile: null,             // Copy of the profile used to connect
    };
  }

  /**
   * Get or create the connection state for a profile.
   *
   * @param {string} profileId
   * @returns {object}
   */
  function getState(profileId) {
    var cs = connections.get(profileId);
    if (!cs) {
      cs = createConnectionState(profileId);
      connections.set(profileId, cs);
    }
    return cs;
  }

  /**
   * Set state and broadcast changes.
   *
   * @param {string} profileId
   * @param {string} newState
   * @param {string} [errorMsg]
   */
  function setState(profileId, newState, errorMsg) {
    var cs = getState(profileId);
    var oldState = cs.state;
    cs.state = newState;
    if (errorMsg) {
      cs.lastError = errorMsg;
    }

    log('[SshRuntime] ' + profileId + ': ' + oldState + ' -> ' + newState +
        (errorMsg ? ' (' + errorMsg + ')' : ''));

    emitter.emit('status-changed', profileId, {
      profileId: profileId,
      state: newState,
      oldState: oldState,
      error: errorMsg || '',
      connectedAt: cs.connectedAt,
    });

    onStatusChange(profileId, {
      profileId: profileId,
      state: newState,
      oldState: oldState,
      error: errorMsg || '',
      connectedAt: cs.connectedAt,
    });
  }

  /**
   * Clear all timers for a connection.
   *
   * @param {object} cs - Connection state
   */
  function clearTimers(cs) {
    var timers = cs.timers;
    if (timers.connectTimeout) {
      clearTimeout(timers.connectTimeout);
      timers.connectTimeout = null;
    }
    if (timers.reconnectTimer) {
      clearTimeout(timers.reconnectTimer);
      timers.reconnectTimer = null;
    }
    if (timers.healthCheckTimer) {
      clearInterval(timers.healthCheckTimer);
      timers.healthCheckTimer = null;
    }
    if (timers.healthProbeTimer) {
      clearTimeout(timers.healthProbeTimer);
      timers.healthProbeTimer = null;
    }
  }

  /**
   * Kill the SSH child process for a connection.
   *
   * @param {object} cs - Connection state
   */
  function killChild(cs) {
    if (cs.child) {
      try {
        cs.child.kill('SIGTERM');
        // Give it a moment, then SIGKILL
        setTimeout(function () {
          try {
            if (cs.child && !cs.child.killed) {
              cs.child.kill('SIGKILL');
            }
          } catch (_) {}
        }, 2000);
      } catch (_) {}
      cs.child = null;
    }
  }

  /**
   * Broadcast the current status for all profiles.
   */
  function broadcastAll() {
    connections.forEach(function (cs, profileId) {
      emitter.emit('status-changed', profileId, {
        profileId: profileId,
        state: cs.state,
        error: cs.lastError,
        connectedAt: cs.connectedAt,
      });
    });
  }

  // ── Connection logic ─────────────────────────────

  /**
   * Initiate an SSH connection for the given profile.
   *
   * @param {object} profile - Validated SSH profile
   * @returns {boolean} true if connect was initiated
   */
  function connect(profile) {
    if (!profile || !profile.id || !profile.host) {
      log('[SshRuntime] connect called with invalid profile');
      return false;
    }

    var profileId = profile.id;
    var cs = getState(profileId);

    // If already connected or connecting, skip
    if (cs.state === STATES.CONNECTED || cs.state === STATES.CONNECTING) {
      log('[SshRuntime] ' + profileId + ' already ' + cs.state + ', skipping connect');
      return false;
    }

    // Clean up any previous state
    clearTimers(cs);
    killChild(cs);

    // Reset backoff on manual connect
    cs.backoff.attempt = 0;
    cs.unknownStrikes = 0;
    cs.stderrBuf = '';
    cs.lastError = '';
    cs.profile = Object.assign({}, profile);

    setState(profileId, STATES.CONNECTING);

    var localPort = getLocalPort();
    var sshArgs = buildSshArgs(profile, localPort);

    log('[SshRuntime] Spawning SSH for ' + profileId + ': ssh ' + sshArgs.join(' '));

    try {
      var child = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      cs.child = child;

      // ── Stderr handling ────────────────────────────
      child.stderr.on('data', function (data) {
        var text = data.toString('utf-8');
        cs.stderrBuf += text;

        // Detect connection establishment
        if (
          cs.state === STATES.CONNECTING &&
          (text.indexOf('Entering interactive session') >= 0 ||
           text.indexOf('authenticated') >= 0 ||
           text.indexOf('debug1:') >= 0 && text.indexOf('Entering') >= 0)
        ) {
          // Connection established
          clearTimers(cs);
          cs.connectedAt = Date.now();
          setState(profileId, STATES.CONNECTED);
          startHealthChecks(profileId);
        }
      });

      // ── Error handling ─────────────────────────────
      child.on('error', function (err) {
        log('[SshRuntime] ' + profileId + ' process error: ' + err.message);
        clearTimers(cs);
        cs.lastError = err.message;
        handleDisconnect(profileId, err.message);
      });

      // ── Exit handling ──────────────────────────────
      child.on('exit', function (code, signal) {
        log('[SshRuntime] ' + profileId + ' exited code=' + code + ' signal=' + signal);
        cs.child = null;
        clearTimers(cs);

        if (cs.state === STATES.CONNECTING) {
          // Connection never established
          var classified = classifyStderr(cs.stderrBuf);
          cs.lastError = classified.message || ('SSH exited with code ' + code);
          setState(profileId, STATES.FAILED, cs.lastError);

          // Schedule reconnect if recoverable
          if (classified.recoverable) {
            scheduleReconnect(profileId, classified.message);
          }
        } else if (cs.state === STATES.CONNECTED || cs.state === STATES.RECONNECTING) {
          cs.connectedAt = null;
          var exitClassified = classifyStderr(cs.stderrBuf + ' broken pipe');
          cs.lastError = exitClassified.message || ('Connection lost (exit code ' + code + ')');
          setState(profileId, STATES.DISCONNECTED, cs.lastError);
          scheduleReconnect(profileId, cs.lastError);
        }
      });

      // ── Connect timeout ────────────────────────────
      cs.timers.connectTimeout = setTimeout(function () {
        if (cs.state === STATES.CONNECTING) {
          log('[SshRuntime] ' + profileId + ' connect timeout');
          var timeoutClassified = classifyStderr(cs.stderrBuf);
          if (cs.stderrBuf.length > 0) {
            cs.lastError = timeoutClassified.message || 'Connection timeout';
          } else {
            cs.lastError = 'Connection timeout — no response from remote host';
          }

          killChild(cs);

          if (timeoutClassified.recoverable || cs.stderrBuf.length === 0) {
            setState(profileId, STATES.FAILED, cs.lastError);
            scheduleReconnect(profileId, cs.lastError);
          } else {
            setState(profileId, STATES.FAILED, cs.lastError);
          }
        }
      }, CONNECT_TIMEOUT);

      return true;

    } catch (err) {
      log('[SshRuntime] Failed to spawn SSH for ' + profileId + ': ' + err.message);
      cs.lastError = err.message;
      setState(profileId, STATES.FAILED, err.message);
      return false;
    }
  }

  // ── Disconnect ───────────────────────────────────

  /**
   * Disconnect a profile's SSH tunnel.
   *
   * @param {string} profileId
   */
  function disconnect(profileId) {
    var cs = connections.get(profileId);
    if (!cs) return;

    log('[SshRuntime] Disconnecting ' + profileId);

    clearTimers(cs);
    killChild(cs);

    cs.backoff.attempt = 0;
    cs.unknownStrikes = 0;
    cs.stderrBuf = '';
    cs.connectedAt = null;

    setState(profileId, STATES.DISCONNECTED, 'User disconnected');
  }

  /**
   * Handle an unexpected disconnect.
   *
   * @param {string} profileId
   * @param {string} [errorMsg]
   */
  function handleDisconnect(profileId, errorMsg) {
    var cs = connections.get(profileId);
    if (!cs) return;

    clearTimers(cs);
    cs.connectedAt = null;

    var msg = errorMsg || 'Connection lost';
    cs.lastError = msg;

    setState(profileId, STATES.DISCONNECTED, msg);
    scheduleReconnect(profileId, msg);
  }

  // ── Reconnection ─────────────────────────────────

  /**
   * Schedule an automatic reconnection attempt with exponential backoff.
   *
   * @param {string} profileId
   * @param {string} [reason]
   */
  function scheduleReconnect(profileId, reason) {
    var cs = connections.get(profileId);
    if (!cs) return;
    if (cs.state === STATES.CONNECTED || cs.state === STATES.CONNECTING) return;

    // Check profile is still valid
    if (!cs.profile) return;

    var schedule = cs.backoff.schedule;
    var attempt = cs.backoff.attempt;
    var delay = attempt < schedule.length
      ? schedule[attempt]
      : schedule[schedule.length - 1];

    cs.backoff.attempt = attempt + 1;

    log('[SshRuntime] ' + profileId + ' reconnecting in ' + (delay / 1000) + 's (attempt ' + cs.backoff.attempt + ')');

    setState(profileId, STATES.RECONNECTING, 'Reconnecting in ' + (delay / 1000) + 's...' + (reason ? ' (' + reason + ')' : ''));

    cs.timers.reconnectTimer = setTimeout(function () {
      // Re-check state — user may have disconnected manually
      var current = connections.get(profileId);
      if (!current) return;
      if (current.state === STATES.DISCONNECTED || current.state === STATES.RECONNECTING || current.state === STATES.FAILED) {
        connect(current.profile);
      }
    }, delay);
  }

  // ── Health probing ───────────────────────────────

  /**
   * Start periodic health checks for a connected profile.
   *
   * @param {string} profileId
   */
  function startHealthChecks(profileId) {
    var cs = connections.get(profileId);
    if (!cs) return;

    // Clear any existing health check timer
    if (cs.timers.healthCheckTimer) {
      clearInterval(cs.timers.healthCheckTimer);
    }

    cs.timers.healthCheckTimer = setInterval(function () {
      performHealthCheck(profileId);
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Perform a single health check via SSH.
   *
   * Spawns a separate SSH process to curl the local hook server
   * through the reverse tunnel and checks for the x-ciallo-server header.
   *
   * @param {string} profileId
   */
  function performHealthCheck(profileId) {
    var cs = connections.get(profileId);
    if (!cs || cs.state !== STATES.CONNECTED) return;
    if (!cs.profile) return;

    var profile = cs.profile;
    var remotePort = profile.remoteForwardPort || 23333;

    log('[SshRuntime] Health check for ' + profileId + ' on port ' + remotePort);

    // Build command to curl localhost through the tunnel
    var probeArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-p', String(profile.port || 22),
    ];

    if (profile.identityFile) {
      probeArgs.push('-i', profile.identityFile);
    }

    probeArgs.push(profile.host, '--');
    probeArgs.push('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:' + remotePort + '/state');

    var probeChild;
    try {
      probeChild = spawn('ssh', probeArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: HEALTH_PROBE_TIMEOUT,
      });
    } catch (err) {
      log('[SshRuntime] Health probe spawn failed for ' + profileId + ': ' + err.message);
      return;
    }

    var probeTimer = setTimeout(function () {
      try { probeChild.kill(); } catch (_) {}
      log('[SshRuntime] Health probe timed out for ' + profileId);
      handleUnhealthy(profileId, 'Health probe timed out');
    }, HEALTH_PROBE_TIMEOUT);

    var stdout = '';
    var stderr = '';

    probeChild.stdout.on('data', function (data) {
      stdout += data.toString('utf-8');
    });

    probeChild.stderr.on('data', function (data) {
      stderr += data.toString('utf-8');
    });

    probeChild.on('error', function (err) {
      clearTimeout(probeTimer);
      log('[SshRuntime] Health probe error for ' + profileId + ': ' + err.message);
      handleUnhealthy(profileId, err.message);
    });

    probeChild.on('exit', function (code) {
      clearTimeout(probeTimer);
      if (cs.state !== STATES.CONNECTED) return;

      if (code === 0 && stdout.trim() === '200') {
        // Healthy — reset unknown strikes
        cs.unknownStrikes = 0;
        log('[SshRuntime] Health check passed for ' + profileId);
      } else {
        // Check stderr for meaningful errors
        var classified = classifyStderr(stderr);
        if (classified.category === 'unknown') {
          cs.unknownStrikes++;
          log('[SshRuntime] Health check ambiguous for ' + profileId +
              ' (strike ' + cs.unknownStrikes + '/' + MAX_UNKNOWN_STRIKES + ')');

          if (cs.unknownStrikes >= MAX_UNKNOWN_STRIKES) {
            handleUnhealthy(profileId, 'Health check failed ' + MAX_UNKNOWN_STRIKES + ' times');
          }
        } else {
          handleUnhealthy(profileId, classified.message);
        }
      }
    });
  }

  /**
   * Handle an unhealthy health check result.
   *
   * @param {string} profileId
   * @param {string} reason
   */
  function handleUnhealthy(profileId, reason) {
    var cs = connections.get(profileId);
    if (!cs) return;

    log('[SshRuntime] ' + profileId + ' unhealthy: ' + reason);

    clearTimers(cs);
    killChild(cs);
    cs.connectedAt = null;
    cs.lastError = reason;

    setState(profileId, STATES.DISCONNECTED, reason);
    scheduleReconnect(profileId, reason);
  }

  // ── Public API ───────────────────────────────────

  /**
   * Get the current status of a specific profile.
   *
   * @param {string} profileId
   * @returns {object|null}
   */
  function getStatus(profileId) {
    var cs = connections.get(profileId);
    if (!cs) return null;

    return {
      profileId: cs.profileId,
      state: cs.state,
      connectedAt: cs.connectedAt,
      error: cs.lastError,
      attempt: cs.backoff.attempt,
    };
  }

  /**
   * Get statuses for all tracked profiles.
   *
   * @returns {object[]}
   */
  function listStatuses() {
    var result = [];
    connections.forEach(function (cs) {
      result.push({
        profileId: cs.profileId,
        state: cs.state,
        connectedAt: cs.connectedAt,
        error: cs.lastError,
        attempt: cs.backoff.attempt,
      });
    });
    return result;
  }

  /**
   * Get statuses for a given set of profile IDs.
   *
   * @param {string[]} profileIds
   * @returns {object[]}
   */
  function listStatusesFor(profileIds) {
    if (!Array.isArray(profileIds)) return [];
    return profileIds.map(function (id) {
      var status = getStatus(id);
      return status || {
        profileId: id,
        state: STATES.IDLE,
        connectedAt: null,
        error: '',
        attempt: 0,
      };
    });
  }

  /**
   * Clean up all connections and timers.
   */
  function destroy() {
    log('[SshRuntime] Destroying all connections');

    connections.forEach(function (cs) {
      clearTimers(cs);
      killChild(cs);
    });

    connections.clear();
    emitter.removeAllListeners();
  }

  /**
   * Get the EventEmitter instance for external listeners.
   *
   * @returns {EventEmitter}
   */
  function getEmitter() {
    return emitter;
  }

  // ── Export API ───────────────────────────────────
  return {
    connect: connect,
    disconnect: disconnect,
    getStatus: getStatus,
    listStatuses: listStatuses,
    listStatusesFor: listStatusesFor,
    destroy: destroy,
    getEmitter: getEmitter,
    broadcastAll: broadcastAll,
    // Exposed for testing/diagnostics
    _classifyStderr: classifyStderr,
    _STATES: STATES,
  };
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  createRemoteSshRuntime,
  classifyStderr,
  STATES: STATES,
  DEFAULT_BACKOFF: DEFAULT_BACKOFF,
};
