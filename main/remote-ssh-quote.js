/**
 * main/remote-ssh-quote.js — Shell quoting utilities
 *
 * Portable string escaping for SSH command construction.
 * Handles Bourne/POSIX shell, Windows cmd.exe, and PowerShell quoting.
 *
 * @module main/remote-ssh-quote
 */

'use strict';

// ─── POSIX / Bourne Shell ─────────────────────────────────────────────────────

/**
 * Escape a single argument for Bourne/POSIX shell.
 *
 * Single-quote wrapping with proper handling of embedded single quotes:
 *   "'" ⇒ '\''  (end quote, escaped literal, reopen quote)
 *
 * @param {string} str - Raw argument value
 * @returns {string} Safely quoted string for POSIX shell
 */
function shQuote(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  if (str.length === 0) {
    return "''";
  }
  // Replace each ' with '"'"' (end-quote, double-quote-escaped single-quote, reopen-quote)
  var replaced = str.replace(/'/g, "'\"'\"'");
  return "'" + replaced + "'";
}

/**
 * Escape a path for POSIX shell, preserving leading tilde.
 *
 * @param {string} path - File path possibly starting with ~
 * @returns {string} Safely quoted path
 */
function shQuotePath(path) {
  if (typeof path !== 'string') {
    path = String(path);
  }
  if (path.length === 0) {
    return "''";
  }
  // If starts with ~, let the shell expand it — quote only the rest
  if (path.charAt(0) === '~') {
    var rest = path.slice(1);
    if (rest.length === 0) {
      return '~';
    }
    return '~' + shQuote(rest);
  }
  return shQuote(path);
}

// ─── Windows cmd.exe ──────────────────────────────────────────────────────────

/**
 * Escape a single argument for Windows cmd.exe.
 *
 * Caret-escaping for special chars: ^ & | < > ( ) % ! " and newline.
 * The argument is NOT wrapped in quotes here; the caller should add
 * surrounding double quotes if the argument contains spaces.
 *
 * @param {string} str - Raw argument value
 * @returns {string} cmd.exe-escaped string
 */
function cmdQuote(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  // Characters that need caret-escaping in cmd.exe (unquoted)
  return str.replace(/[\^&|<>()%!"\r\n]/g, function (ch) {
    if (ch === '\r') return '^\r';
    if (ch === '\n') return '^\n';
    return '^' + ch;
  });
}

/**
 * Escape and wrap an argument for Windows cmd.exe double-quoting.
 *
 * @param {string} str - Raw argument value
 * @returns {string} Double-quoted cmd.exe-safe string
 */
function cmdQuoteArg(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  // Inside double quotes, only ", \, and % need escaping
  var escaped = str.replace(/[\\"]/g, function (ch) {
    return '\\' + ch;
  });
  return '"' + escaped + '"';
}

// ─── PowerShell ───────────────────────────────────────────────────────────────

/**
 * Escape a single argument for PowerShell.
 *
 * Backtick-escaping special chars: ` $ " ' # ( ) { } [ ] & | < > ; @ %
 *
 * @param {string} str - Raw argument value
 * @returns {string} PowerShell-safe quoted string (single-quoted)
 */
function psQuote(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  if (str.length === 0) {
    return "''";
  }
  // Single-quoted PowerShell strings only escape single quotes by doubling them
  var escaped = str.replace(/'/g, "''");
  return "'" + escaped + "'";
}

/**
 * Escape a string for use inside a PowerShell double-quoted string ("...").
 * Backtick-escapes $ ` " and line endings.
 *
 * @param {string} str - Raw argument value
 * @returns {string} Double-quoted PowerShell-safe string
 */
function psDoubleQuote(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  var escaped = str.replace(/[`$"\r\n]/g, function (ch) {
    if (ch === '\r') return '`r';
    if (ch === '\n') return '`n';
    return '`' + ch;
  });
  return '"' + escaped + '"';
}

// ─── SSH-specific helpers ─────────────────────────────────────────────────────

/**
 * Build a quoted SSH remote-forward argument (-R).
 *
 * Ensures the port range and binding address are safely formatted.
 *
 * @param {number} remotePort - Port on the remote side (23333-23337)
 * @param {number} localPort - Port on the local side (usually same)
 * @param {string} [bindAddress='127.0.0.1'] - Remote bind address
 * @returns {string} Formatted -R argument value
 */
function sshRemoteForward(remotePort, localPort, bindAddress) {
  if (typeof remotePort !== 'number') remotePort = Number(remotePort);
  if (typeof localPort !== 'number') localPort = Number(localPort);
  if (typeof bindAddress !== 'string' || bindAddress.length === 0) {
    bindAddress = '127.0.0.1';
  }
  return bindAddress + ':' + remotePort + ':127.0.0.1:' + localPort;
}

/**
 * Build a complete SSH command-line argument array from a profile.
 *
 * @param {object} profile - Validated SSH profile
 * @param {number} [profile.port] - Remote SSH port (default 22)
 * @param {string} [profile.identityFile] - Path to SSH private key
 * @param {number} profile.remoteForwardPort - Remote forwarding port
 * @param {number} localPort - Local hook server port
 * @param {string} profile.host - Remote hostname/IP
 * @returns {string[]} Array of arguments for spawn('ssh', args)
 */
function buildSshArgs(profile, localPort) {
  var args = [];

  // Mode: no shell/command, just forward
  args.push('-N');

  // Remote forward: -R <remotePort>:127.0.0.1:<localPort>
  var forwardStr = sshRemoteForward(profile.remoteForwardPort, localPort);
  args.push('-R', forwardStr);

  // Connection resilience
  args.push('-o', 'ExitOnForwardFailure=yes');
  args.push('-o', 'ServerAliveInterval=30');
  args.push('-o', 'ServerAliveCountMax=3');

  // Port
  var port = profile.port;
  if (typeof port !== 'number' || port < 1 || port > 65535) {
    port = 22;
  }
  if (port !== 22) {
    args.push('-p', String(port));
  }

  // Identity file
  if (profile.identityFile && typeof profile.identityFile === 'string') {
    args.push('-i', profile.identityFile);
  }

  // Host (specified as user@host)
  args.push(profile.host);

  return args;
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  shQuote,
  shQuotePath,
  cmdQuote,
  cmdQuoteArg,
  psQuote,
  psDoubleQuote,
  sshRemoteForward,
  buildSshArgs,
};
