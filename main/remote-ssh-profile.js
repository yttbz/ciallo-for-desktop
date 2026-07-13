/**
 * main/remote-ssh-profile.js — SSH Profile validation
 *
 * Validates raw SSH connection profiles with strict field constraints.
 * Returns structured { valid, profile, errors } results.
 *
 * @module main/remote-ssh-profile
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Minimum allowed remote forwarding port. */
const REMOTE_PORT_MIN = 23333;

/** Maximum allowed remote forwarding port. */
const REMOTE_PORT_MAX = 23337;

/** Default SSH port. */
const DEFAULT_SSH_PORT = 22;

/** Maximum length for label and host fields. */
const MAX_STRING_LENGTH = 256;

/** Maximum length for identity file path. */
const MAX_PATH_LENGTH = 1024;

/** Maximum length for host prefix. */
const MAX_PREFIX_LENGTH = 64;

/**
 * Valid host prefixes for display/grouping.
 * @type {string[]}
 */
const VALID_HOST_PREFIXES = [
  'rpi',
  'server',
  'vps',
  'nas',
  'dev',
  'vm',
  'docker',
  'cloud',
  'edge',
  'custom',
];

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Check if a value is a non-empty string within length bounds.
 *
 * @param {*} val
 * @param {number} [maxLen=MAX_STRING_LENGTH]
 * @returns {boolean}
 */
function isString(val, maxLen) {
  if (typeof val !== 'string') return false;
  var limit = (typeof maxLen === 'number') ? maxLen : MAX_STRING_LENGTH;
  return val.length > 0 && val.length <= limit;
}

/**
 * Check if a value is a valid port number (1-65535).
 *
 * @param {*} val
 * @returns {boolean}
 */
function isValidPort(val) {
  return typeof val === 'number' &&
         Number.isInteger(val) &&
         val >= 1 &&
         val <= 65535;
}

/**
 * Check if a value is a valid remote forward port (23333-23337).
 *
 * @param {*} val
 * @returns {boolean}
 */
function isValidRemotePort(val) {
  return typeof val === 'number' &&
         Number.isInteger(val) &&
         val >= REMOTE_PORT_MIN &&
         val <= REMOTE_PORT_MAX;
}

/**
 * Check if a hostname is reasonably valid.
 *
 * Accepts hostnames, IPv4 addresses, and simple IPv6 (bracket-wrapped).
 *
 * @param {string} host
 * @returns {boolean}
 */
function isValidHost(host) {
  if (typeof host !== 'string' || host.length === 0) return false;

  // Allow user@host format
  var hostPart = host;
  var atIdx = host.indexOf('@');
  if (atIdx >= 0) {
    // Validate user part
    var user = host.slice(0, atIdx);
    if (!/^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/.test(user)) return false;
    if (user.length > 64) return false;
    hostPart = host.slice(atIdx + 1);
  }

  if (hostPart.length === 0 || hostPart.length > MAX_STRING_LENGTH) return false;

  // Strip port suffix (host:port) — not validating port existence here
  hostPart = hostPart.replace(/:\d+$/, '');

  // IPv6 bracket notation
  if (hostPart.charAt(0) === '[') {
    if (hostPart.charAt(hostPart.length - 1) !== ']') return false;
    hostPart = hostPart.slice(1, -1);
    // Simplified IPv6 check: at least one colon
    return hostPart.indexOf(':') >= 0 && /^[0-9a-fA-F:]+$/.test(hostPart);
  }

  // IPv4
  var ipv4Parts = hostPart.split('.');
  if (ipv4Parts.length === 4) {
    return ipv4Parts.every(function (octet) {
      var n = Number(octet);
      return !isNaN(n) && n >= 0 && n <= 255 && String(n) === octet;
    });
  }

  // Hostname
  if (hostPart.length > 253) return false;
  var labels = hostPart.split('.');
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
  }

  return true;
}

/**
 * Check if a value is a valid host prefix.
 *
 * @param {*} val
 * @returns {boolean}
 */
function isValidHostPrefix(val) {
  if (typeof val !== 'string' || val.length === 0) return false;
  if (val.length > MAX_PREFIX_LENGTH) return false;
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(val);
}

/**
 * Sanitize a string: strip control characters and trim whitespace.
 *
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

// ─── Profile Validation ───────────────────────────────────────────────────────

/**
 * Default field values for a profile.
 *
 * @type {object}
 */
var DEFAULT_PROFILE = {
  id: '',
  label: '',
  host: '',
  port: DEFAULT_SSH_PORT,
  identityFile: '',
  remoteForwardPort: 23333,
  hostPrefix: '',
  connectOnLaunch: false,
  autoStartCodexMonitor: false,
};

/**
 * Validate a raw SSH profile object.
 *
 * Accepts partial profiles — missing fields are filled with defaults.
 * Returns all validation errors in the errors array.
 *
 * @param {*} raw - Raw profile data (from IPC / settings JSON)
 * @returns {{ valid: boolean, profile: object, errors: string[] }}
 */
function validateProfile(raw) {
  var errors = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      profile: Object.assign({}, DEFAULT_PROFILE),
      errors: ['Profile must be a non-null object'],
    };
  }

  var profile = {};
  var id = raw.id;
  var label = raw.label;
  var host = raw.host;
  var port = raw.port;
  var identityFile = raw.identityFile;
  var remoteForwardPort = raw.remoteForwardPort;
  var hostPrefix = raw.hostPrefix;
  var connectOnLaunch = raw.connectOnLaunch;
  var autoStartCodexMonitor = raw.autoStartCodexMonitor;

  // ── id ────────────────────────────────────────────
  if (typeof id === 'string' && id.length > 0) {
    if (id.length > 128) {
      errors.push('id exceeds maximum length of 128 characters');
      profile.id = id.slice(0, 128);
    } else if (!/^[a-zA-Z0-9_.@\-]+$/.test(id)) {
      errors.push('id contains disallowed characters (alphanumeric, _, ., @, - only)');
      profile.id = id.replace(/[^a-zA-Z0-9_.@\-]/g, '');
    } else {
      profile.id = id;
    }
  } else if (raw.id === undefined || raw.id === null) {
    errors.push('id is required');
    profile.id = '';
  } else {
    errors.push('id must be a non-empty string');
    profile.id = '';
  }

  // ── label ─────────────────────────────────────────
  if (label !== undefined && label !== null) {
    if (typeof label === 'string') {
      var cleanedLabel = sanitize(label);
      if (cleanedLabel.length > MAX_STRING_LENGTH) {
        errors.push('label exceeds maximum length of ' + MAX_STRING_LENGTH);
        profile.label = cleanedLabel.slice(0, MAX_STRING_LENGTH);
      } else {
        profile.label = cleanedLabel;
      }
    } else {
      errors.push('label must be a string');
      profile.label = '';
    }
  } else {
    profile.label = host && typeof host === 'string' ? host : '';
  }

  // ── host ───────────────────────────────────────────
  if (host !== undefined && host !== null) {
    if (typeof host === 'string') {
      var cleanedHost = sanitize(host);
      if (!isValidHost(cleanedHost)) {
        errors.push('host is not a valid hostname, IP, or user@host string');
        profile.host = cleanedHost;
      } else if (cleanedHost.length === 0) {
        errors.push('host must not be empty');
        profile.host = '';
      } else {
        profile.host = cleanedHost;
      }
    } else {
      errors.push('host must be a string');
      profile.host = '';
    }
  } else {
    errors.push('host is required');
    profile.host = '';
  }

  // ── port ───────────────────────────────────────────
  if (port !== undefined && port !== null) {
    if (isValidPort(port)) {
      profile.port = port;
    } else if (typeof port === 'string') {
      var parsedPort = parseInt(port, 10);
      if (isValidPort(parsedPort)) {
        profile.port = parsedPort;
      } else {
        errors.push('port must be a number between 1 and 65535');
        profile.port = DEFAULT_SSH_PORT;
      }
    } else {
      errors.push('port must be a number between 1 and 65535');
      profile.port = DEFAULT_SSH_PORT;
    }
  } else {
    profile.port = DEFAULT_SSH_PORT;
  }

  // ── identityFile ──────────────────────────────────
  if (identityFile !== undefined && identityFile !== null) {
    if (typeof identityFile === 'string') {
      var cleanedPath = sanitize(identityFile);
      if (cleanedPath.length > MAX_PATH_LENGTH) {
        errors.push('identityFile exceeds maximum length of ' + MAX_PATH_LENGTH);
        profile.identityFile = cleanedPath.slice(0, MAX_PATH_LENGTH);
      } else {
        profile.identityFile = cleanedPath;
      }
    } else {
      errors.push('identityFile must be a string');
      profile.identityFile = '';
    }
  } else {
    profile.identityFile = '';
  }

  // ── remoteForwardPort ─────────────────────────────
  if (remoteForwardPort !== undefined && remoteForwardPort !== null) {
    if (isValidRemotePort(remoteForwardPort)) {
      profile.remoteForwardPort = remoteForwardPort;
    } else if (typeof remoteForwardPort === 'string') {
      var parsedRfp = parseInt(remoteForwardPort, 10);
      if (isValidRemotePort(parsedRfp)) {
        profile.remoteForwardPort = parsedRfp;
      } else {
        errors.push('remoteForwardPort must be a number between ' + REMOTE_PORT_MIN + ' and ' + REMOTE_PORT_MAX);
        profile.remoteForwardPort = 23333;
      }
    } else {
      errors.push('remoteForwardPort must be a number between ' + REMOTE_PORT_MIN + ' and ' + REMOTE_PORT_MAX);
      profile.remoteForwardPort = 23333;
    }
  } else {
    profile.remoteForwardPort = 23333;
  }

  // ── hostPrefix ────────────────────────────────────
  if (hostPrefix !== undefined && hostPrefix !== null) {
    if (typeof hostPrefix === 'string') {
      var cleanedPrefix = sanitize(hostPrefix);
      if (cleanedPrefix.length === 0) {
        profile.hostPrefix = '';
      } else if (!isValidHostPrefix(cleanedPrefix)) {
        errors.push('hostPrefix must start with a letter and contain only letters, digits, underscores, hyphens');
        profile.hostPrefix = '';
      } else {
        profile.hostPrefix = cleanedPrefix;
      }
    } else {
      errors.push('hostPrefix must be a string');
      profile.hostPrefix = '';
    }
  } else {
    profile.hostPrefix = '';
  }

  // ── connectOnLaunch (boolean) ─────────────────────
  profile.connectOnLaunch = typeof connectOnLaunch === 'boolean'
    ? connectOnLaunch
    : false;

  // ── autoStartCodexMonitor (boolean) ───────────────
  profile.autoStartCodexMonitor = typeof autoStartCodexMonitor === 'boolean'
    ? autoStartCodexMonitor
    : false;

  return {
    valid: errors.length === 0,
    profile: profile,
    errors: errors,
  };
}

/**
 * Validate an array of SSH profiles.
 *
 * @param {*} rawArray - Raw profiles array from settings
 * @returns {{ valid: boolean, profiles: object[], errors: object[] }}
 */
function validateProfileArray(rawArray) {
  if (!Array.isArray(rawArray)) {
    return {
      valid: false,
      profiles: [],
      errors: [{ index: -1, errors: ['Expected an array of profiles'] }],
    };
  }

  var profiles = [];
  var allErrors = [];

  for (var i = 0; i < rawArray.length; i++) {
    var result = validateProfile(rawArray[i]);
    profiles.push(result.profile);
    if (result.errors.length > 0) {
      allErrors.push({ index: i, errors: result.errors });
    }
  }

  return {
    valid: allErrors.length === 0,
    profiles: profiles,
    errors: allErrors,
  };
}

/**
 * Get a default empty profile (useful for UI forms).
 *
 * @returns {object}
 */
function getEmptyProfile() {
  return Object.assign({}, DEFAULT_PROFILE);
}

/**
 * Get the valid host prefix list for UI dropdowns.
 *
 * @returns {string[]}
 */
function getValidHostPrefixes() {
  return VALID_HOST_PREFIXES.slice();
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  validateProfile,
  validateProfileArray,
  getEmptyProfile,
  getValidHostPrefixes,
  REMOTE_PORT_MIN: REMOTE_PORT_MIN,
  REMOTE_PORT_MAX: REMOTE_PORT_MAX,
  DEFAULT_SSH_PORT: DEFAULT_SSH_PORT,
};
