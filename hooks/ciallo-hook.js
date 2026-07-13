#!/usr/bin/env node
/**
 * hooks/ciallo-hook.js — CialloForDesktop Claude Code Hook Script
 *
 * Claude Code runs this script every time an event happens.
 * It reads the JSON payload from stdin and POSTs the state to
 * the CialloForDesktop local HTTP server.
 *
 * Usage: node ciallo-hook.js <event_name>
 *
 * @module hooks/ciallo-hook
 */

'use strict';

const http = require('http');
const { postStateToRunningServer } = require('./server-config');

// ─── Constants ───────────────────────────────────────────────────────────────

const STDIN_READ_TIMEOUT_MS = 2000;
const STATE_POST_TIMEOUT_MS = 100;
const COMPLETION_POST_TIMEOUT_MS = 1500;
const SESSION_TITLE_MAX = 80;

/** Event to state mapping (mirrors main/state.js EVENT_TO_STATE). */
const EVENT_TO_STATE = {
  SessionStart:       'idle',
  SessionEnd:         'sleeping',
  UserPromptSubmit:   'working',
  PreToolUse:         'thinking',
  PostToolUse:        'working',
  PostToolUseFailure: 'error',
  Stop:               'attention',
  StopFailure:        'error',
  SubagentStart:      'juggling',
  SubagentStop:       'working',
  Notification:       'notification',
};

/** Event types that are completion-like (use longer timeout). */
const COMPLETION_EVENTS = new Set(['Stop', 'StopFailure']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read all stdin as a string with a timeout.
 * @param {number} timeoutMs
 * @returns {Promise<{payload: object|null, bytes: number, timedOut: boolean}>}
 */
function readStdin(timeoutMs) {
  return new Promise(function (resolve) {
    var chunks = [];
    var bytesRead = 0;
    var timedOut = false;

    var timer = setTimeout(function () {
      timedOut = true;
      resolve({ payload: null, bytes: bytesRead, timedOut: true });
    }, timeoutMs);

    function onData(chunk) {
      chunks.push(chunk);
      bytesRead += chunk.length;
      // Safety cap: 64KB max
      if (bytesRead > 65536) {
        cleanup();
        resolve({ payload: null, bytes: bytesRead, timedOut: false });
      }
    }

    function onEnd() {
      cleanup();
      var raw = Buffer.concat(chunks).toString('utf8').trim();
      var payload = null;
      if (raw) {
        try { payload = JSON.parse(raw); } catch (e) { payload = null; }
      }
      resolve({ payload: payload, bytes: bytesRead, timedOut: false });
    }

    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
    }

    if (process.stdin.isTTY || process.stdin.destroyed) {
      cleanup();
      resolve({ payload: null, bytes: 0, timedOut: false });
      return;
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
  });
}

/**
 * Normalize a session title (strip control chars, truncate).
 * @param {string} value
 * @returns {string|null}
 */
function normalizeTitle(value) {
  if (typeof value !== 'string') return null;
  var cleaned = value.replace(/[\x00-\x1F\x7F-\x9F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > SESSION_TITLE_MAX
    ? cleaned.slice(0, SESSION_TITLE_MAX - 1) + '…'
    : cleaned;
}

/**
 * Extract a short prompt title from the prompt string.
 * @param {string} prompt
 * @returns {string|null}
 */
function extractPromptTitle(prompt) {
  if (typeof prompt !== 'string') return null;
  var lines = prompt.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var candidate = lines[i].trim();
    if (!candidate) continue;
    // Skip if it looks like a secret/key
    if (/\b(api[_-]?key|authorization|bearer|password|secret|token)\b/i.test(candidate)) return null;
    return normalizeTitle(candidate.length > 40 ? candidate.slice(0, 39) + '…' : candidate);
  }
  return null;
}

/**
 * Build the state body to POST to the server.
 * @param {string} event - Event name
 * @param {object} payload - Parsed stdin payload
 * @returns {object|null}
 */
function buildStateBody(event, payload) {
  var state = EVENT_TO_STATE[event];
  if (!state) return null;

  if (!payload || typeof payload !== 'object') payload = {};

  var sessionId = payload.session_id || 'default';
  var cwd = payload.cwd || '';
  var source = payload.source || payload.reason || '';

  // SessionEnd with "clear" → sweeping
  if (event === 'SessionEnd' && source === 'clear') {
    state = 'sweeping';
  }

  var body = {
    state: state,
    session_id: sessionId,
    event: event,
    agent_id: payload.agent_id || 'claude-code',
  };

  if (cwd) body.cwd = cwd;
  if (payload.tool_name) body.tool_name = payload.tool_name;
  if (payload.tool_use_id) body.tool_use_id = payload.tool_use_id;

  // Session title from payload or transcript
  var sessionTitle = normalizeTitle(payload.session_title);
  if (!sessionTitle && event === 'UserPromptSubmit') {
    sessionTitle = extractPromptTitle(payload.prompt);
  }
  if (sessionTitle) body.session_title = sessionTitle;

  // Context usage
  if (payload.context_usage && typeof payload.context_usage === 'object') {
    body.context_usage = payload.context_usage;
  }

  // Error details
  if (state === 'error') {
    body.error_present = true;
    if (payload.error) body.error_message = String(payload.error).slice(0, 500);
    if (event === 'PostToolUseFailure' && payload.tool_name) {
      body.failure_kind = 'tool_error';
    }
    if (event === 'StopFailure') {
      body.failure_kind = 'stop_failure';
    }
  }

  // Completion meta for Stop events
  if (event === 'Stop') {
    var bgCount = Array.isArray(payload.background_tasks) ? payload.background_tasks.length : 0;
    var cronCount = Array.isArray(payload.session_crons) ? payload.session_crons.length : 0;
    if (bgCount > 0) body.background_tasks_count = bgCount;
    if (cronCount > 0) body.session_crons_count = cronCount;
  }

  return body;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  var event = process.argv[2];
  if (!event || !EVENT_TO_STATE[event]) {
    process.exit(0);
  }

  readStdin(STDIN_READ_TIMEOUT_MS).then(function (result) {
    var payload = result.payload || {};
    var body = buildStateBody(event, payload);
    if (!body) process.exit(0);

    var isCompletion = COMPLETION_EVENTS.has(event);
    var timeoutMs = isCompletion ? COMPLETION_POST_TIMEOUT_MS : STATE_POST_TIMEOUT_MS;

    postStateToRunningServer(
      JSON.stringify(body),
      { timeoutMs: timeoutMs },
      function (posted, port) {
        // Silently exit regardless of success
        process.exit(0);
      }
    );
  }).catch(function () {
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStateBody,
  EVENT_TO_STATE,
};
