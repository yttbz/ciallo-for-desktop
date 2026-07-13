/**
 * main/remote-ssh-shell-detect.js — Remote shell type detection
 *
 * Probes a remote host via SSH to determine the default shell type,
 * which informs quoting strategies and command construction.
 *
 * Supported shell types: bash, zsh, fish, sh, powershell, cmd, unknown
 *
 * @module main/remote-ssh-shell-detect
 */

'use strict';

const { spawn } = require('child_process');

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Cache TTL for shell detection results (5 minutes). */
const CACHE_TTL = 5 * 60 * 1000;

/** Maximum time (ms) to wait for a shell probe response. */
const PROBE_TIMEOUT = 5000;

/** Maximum buffer size for shell probe output. */
const MAX_PROBE_OUTPUT = 2048;

/** Shell type identifier strings. */
const SHELL_TYPES = Object.freeze({
  BASH:       'bash',
  ZSH:        'zsh',
  FISH:       'fish',
  SH:         'sh',
  POWER_SHELL:'powershell',
  CMD:        'cmd',
  UNKNOWN:    'unknown',
});

/**
 * Mapping of shell executable basenames to canonical types.
 * @type {Object<string, string>}
 */
const EXE_TO_TYPE = {
  bash:    SHELL_TYPES.BASH,
  zsh:     SHELL_TYPES.ZSH,
  fish:    SHELL_TYPES.FISH,
  sh:      SHELL_TYPES.SH,
  pwsh:    SHELL_TYPES.POWER_SHELL,
  powershell: SHELL_TYPES.POWER_SHELL,
  cmd:     SHELL_TYPES.CMD,
};

// ─── Shell detection ──────────────────────────────────────────────────────────

/**
 * Build an SSH command array to probe the remote shell.
 *
 * @param {string} host - SSH host string (user@host)
 * @param {number} [port=22] - SSH port
 * @returns {string[]} spawn arguments for the SSH probe
 */
function buildProbeArgs(host, port) {
  var args = [];

  if (typeof port === 'number' && port !== 22) {
    args.push('-p', String(port));
  }

  // Quiet mode, no shell allocation, run a single command
  args.push('-o', 'BatchMode=yes');
  args.push('-o', 'ConnectTimeout=5');
  args.push('-o', 'StrictHostKeyChecking=accept-new');
  args.push(host, '--');

  // Commands to run on the remote side
  args.push(
    'echo "SHELL=$SHELL";' +
    'echo "PARENT=$(ps -p $PPID -o comm= 2>/dev/null || ps -p $PPID -o args= 2>/dev/null)";' +
    'echo "OSTYPE=$(uname -s 2>/dev/null || echo unknown)";' +
    'if command -v fish >/dev/null 2>&1; then echo "HAS_FISH=1"; fi;' +
    'if [ -n "$BASH_VERSION" ]; then echo "IS_BASH=1"; fi;' +
    'if [ -n "$ZSH_VERSION" ]; then echo "IS_ZSH=1"; fi;'
  );

  return args;
}

/**
 * Parse the remote probe output and determine the shell type.
 *
 * @param {string} output - Combined stdout from the probe command
 * @returns {object} { type: string, shell: string, os: string, details: object }
 */
function parseProbeOutput(output) {
  var result = {
    type: SHELL_TYPES.UNKNOWN,
    shell: '',
    os: 'unknown',
    details: {},
  };

  if (!output || typeof output !== 'string') {
    return result;
  }

  var lines = output.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line.indexOf('SHELL=') === 0) {
      result.shell = line.slice(6).trim();
    } else if (line.indexOf('OSTYPE=') === 0) {
      result.os = line.slice(7).trim();
    } else if (line.indexOf('PARENT=') === 0) {
      result.details.parentProcess = line.slice(7).trim();
    } else if (line === 'HAS_FISH=1') {
      result.details.hasFish = true;
    } else if (line === 'IS_BASH=1') {
      result.details.isBash = true;
    } else if (line === 'IS_ZSH=1') {
      result.details.isZsh = true;
    }
  }

  // Resolve shell type from SHELL variable
  if (result.shell) {
    var shellBase = result.shell.split('/').pop().toLowerCase();
    if (EXE_TO_TYPE[shellBase]) {
      result.type = EXE_TO_TYPE[shellBase];
    }
  }

  // Refine with version checks
  if (result.type === SHELL_TYPES.UNKNOWN || result.type === SHELL_TYPES.SH) {
    if (result.details.isBash) {
      result.type = SHELL_TYPES.BASH;
    } else if (result.details.isZsh) {
      result.type = SHELL_TYPES.ZSH;
    } else if (result.details.hasFish) {
      result.type = SHELL_TYPES.FISH;
    }
  }

  // Windows detection
  if (result.os.indexOf('MINGW') >= 0 ||
      result.os.indexOf('MSYS') >= 0 ||
      result.os.indexOf('CYGWIN') >= 0) {
    result.details.isCygwin = true;
  }

  return result;
}

// ─── Shell Detector Class ─────────────────────────────────────────────────────

/**
 * Create a remote shell detector.
 *
 * Caches detection results per host with a configurable TTL.
 *
 * @param {object} [opts]
 * @param {function} [opts.log] - Logger function
 * @param {number} [opts.cacheTtl=CACHE_TTL] - Cache lifetime in ms
 * @returns {object} Detector API
 */
function createShellDetector(opts) {
  opts = opts || {};

  /** @type {function} */
  var log = (typeof opts.log === 'function') ? opts.log : function () {};

  /** @type {number} */
  var cacheTtl = (typeof opts.cacheTtl === 'number' && opts.cacheTtl > 0)
    ? opts.cacheTtl
    : CACHE_TTL;

  /**
   * Detection cache: host -> { type, shell, os, details, timestamp }
   * @type {Map<string, object>}
   */
  var cache = new Map();

  // ── Cache helpers ───────────────────────────────

  /**
   * Get cached result for a host if still valid.
   *
   * @param {string} host
   * @returns {object|null} Cached result or null
   */
  function getCached(host) {
    var entry = cache.get(host);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > cacheTtl) {
      cache.delete(host);
      return null;
    }
    return entry;
  }

  /**
   * Set cache entry for a host.
   *
   * @param {string} host
   * @param {object} result - Detection result
   */
  function setCached(host, result) {
    cache.set(host, {
      type: result.type,
      shell: result.shell,
      os: result.os,
      details: result.details,
      timestamp: Date.now(),
    });
  }

  // ── Public API ──────────────────────────────────

  /**
   * Detect the remote shell type by probing via SSH.
   *
   * @param {string} host - SSH host string (user@host)
   * @param {number} [port=22] - SSH port
   * @param {object} [options]
   * @param {boolean} [options.force=false] - Bypass cache
   * @returns {Promise<{ type: string, shell: string, os: string, details: object }>}
   */
  function detect(host, port, options) {
    return new Promise(function (resolve) {
      if (!host || typeof host !== 'string') {
        resolve({
          type: SHELL_TYPES.UNKNOWN,
          shell: '',
          os: 'unknown',
          details: {},
        });
        return;
      }

      var force = options && options.force;

      if (!force) {
        var cached = getCached(host);
        if (cached) {
          resolve({
            type: cached.type,
            shell: cached.shell,
            os: cached.os,
            details: cached.details,
          });
          return;
        }
      }

      log('[ShellDetect] Probing shell on ' + host + '...');

      var probeArgs = buildProbeArgs(host, port);
      var child = spawn('ssh', probeArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: PROBE_TIMEOUT,
      });

      var stdout = '';
      var stderr = '';
      var timedOut = false;

      var timer = setTimeout(function () {
        timedOut = true;
        child.kill();
        log('[ShellDetect] Probe timed out for ' + host);
        resolve({
          type: SHELL_TYPES.UNKNOWN,
          shell: '',
          os: 'unknown',
          details: { timedOut: true },
        });
      }, PROBE_TIMEOUT);

      child.stdout.on('data', function (data) {
        if (stdout.length < MAX_PROBE_OUTPUT) {
          stdout += data.toString('utf-8').slice(0, MAX_PROBE_OUTPUT - stdout.length);
        }
      });

      child.stderr.on('data', function (data) {
        if (stderr.length < 512) {
          stderr += data.toString('utf-8').slice(0, 512 - stderr.length);
        }
      });

      child.on('error', function (err) {
        clearTimeout(timer);
        log('[ShellDetect] Probe error for ' + host + ': ' + err.message);
        resolve({
          type: SHELL_TYPES.UNKNOWN,
          shell: '',
          os: 'unknown',
          details: { error: err.message },
        });
      });

      child.on('exit', function (code) {
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          log('[ShellDetect] Probe exited with code ' + code + ' for ' + host);
          resolve({
            type: SHELL_TYPES.UNKNOWN,
            shell: '',
            os: 'unknown',
            details: { exitCode: code, stderr: stderr.slice(0, 256) },
          });
          return;
        }

        var result = parseProbeOutput(stdout);
        log('[ShellDetect] Detected shell "' + result.type + '" on ' + host);
        setCached(host, result);
        resolve(result);
      });
    });
  }

  /**
   * Clear the detection cache for a specific host, or all hosts.
   *
   * @param {string} [host] - If omitted, clears entire cache
   */
  function clearCache(host) {
    if (host) {
      cache.delete(host);
    } else {
      cache.clear();
    }
  }

  /**
   * Get the preferred quoting function for a shell type.
   *
   * @param {string} shellType - One of SHELL_TYPES values
   * @returns {string} Name of the quote function to use: 'shQuote', 'cmdQuote', 'psQuote'
   */
  function getQuoteFnName(shellType) {
    switch (shellType) {
      case SHELL_TYPES.BASH:
      case SHELL_TYPES.ZSH:
      case SHELL_TYPES.FISH:
      case SHELL_TYPES.SH:
        return 'shQuote';
      case SHELL_TYPES.CMD:
        return 'cmdQuote';
      case SHELL_TYPES.POWER_SHELL:
        return 'psQuote';
      default:
        return 'shQuote';
    }
  }

  return {
    detect: detect,
    clearCache: clearCache,
    getQuoteFnName: getQuoteFnName,
    SHELL_TYPES: SHELL_TYPES,
  };
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  createShellDetector,
  SHELL_TYPES: SHELL_TYPES,
  buildProbeArgs: buildProbeArgs,
  parseProbeOutput: parseProbeOutput,
};
