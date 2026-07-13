/**
 * main/state.js — Session State Machine for Claude Code Sessions
 *
 * Tracks lifecycle states of Claude Code CLI sessions including
 * subagent juggling, process health, and badge derivation.
 *
 * States (by priority, highest first):
 *   notification > attention > working > thinking > juggling > idle > sleeping
 *
 * Badges: running, done, interrupted, idle
 *
 * Events:
 *   UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
 *   Stop, SessionEnd, SubagentStart, SubagentStop,
 *   PermissionRequest, Notification
 *
 * Ported from clawd-on-desk's state.js.
 *
 * @module main/state
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

/** All valid session states ordered by display priority (highest first). */
const STATE_PRIORITY = Object.freeze([
  'notification',
  'attention',
  'working',
  'thinking',
  'juggling',
  'idle',
  'sleeping',
]);

/** Valid state values as a Set for O(1) lookup. */
const VALID_STATES = new Set(STATE_PRIORITY);

/** Valid badge values. */
const VALID_BADGES = Object.freeze(['running', 'done', 'interrupted', 'idle']);

/**
 * Event type → default state mapping.
 * null means the state is context-dependent and will not be auto-derived.
 */
const EVENT_TO_STATE = {
  UserPromptSubmit:   'working',
  PreToolUse:         'thinking',
  PostToolUse:        null,           // context-dependent; caller should set state explicitly
  PostToolUseFailure: null,           // context-dependent
  Stop:               'idle',
  SessionEnd:         null,           // triggers deletion, not a state transition
  SubagentStart:      'juggling',
  SubagentStop:       null,           // context-dependent; caller decides the return state
  PermissionRequest:  'attention',
  Notification:       'notification',
};

/** Maximum number of recent events retained per session. */
const MAX_RECENT_EVENTS = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether a process is alive using signal-0 (does not actually signal).
 *
 * Uses `process.kill(pid, 0)` which probes process existence without sending
 * a signal. On POSIX, ESRCH means "no such process"; any other error
 * (EPERM, EACCES) means the process exists but the caller lacks permission.
 * On Windows the same semantics apply — we treat every code other than ESRCH
 * as "process exists".
 *
 * @param {number} pid - Process ID to check
 * @returns {boolean} true if the process exists (or access is denied)
 */
function isProcessAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process. Everything else (EPERM, EACCES, …) means the
    // process exists — we just don't have permission / can't signal it.
    return err.code !== 'ESRCH';
  }
}

/**
 * Create a fresh default session record.
 *
 * All fields are initialised to safe zero/empty values so callers never deal
 * with undefined access.
 *
 * @param {string} id - Unique session identifier
 * @returns {object} Default session record
 */
function createDefaultSession(id) {
  return {
    // Identity
    id,
    agentId: '',

    // Lifecycle
    state: 'idle',
    badge: 'idle',

    // Metadata
    sessionTitle: '',
    cwd: '',
    model: '',
    provider: '',
    host: '',
    wslDistro: '',
    headless: false,
    platform: process.platform,

    // Resource tracking
    contextUsage: { used: 0, limit: 0, percent: 0 },

    // Event log
    recentEvents: [],

    // Process info
    agentPid: null,
    sourcePid: null,
    pidReachable: false,

    // Timestamp
    updatedAt: Date.now(),

    // Completion & display
    requiresCompletionAck: false,
    displayHint: '',
    resumeState: '',

    // ── Internal bookkeeping (not part of the public data model) ──
    /** @private Number of active background (subagent) tasks */
    _backgroundTasks: 0,
  };
}

/**
 * Derive a badge from the session's current state and recent events tail.
 *
 * Badge logic:
 *   - Active processing states (working, thinking, juggling, attention,
 *     notification) → `running`
 *   - Sleeping → `idle`
 *   - Idle state whose last event is `Stop` with **no** background tasks
 *     → `interrupted`
 *   - Idle state whose last event is `Stop` **with** background tasks
 *     → `running` (still-alive subagents / hooks)
 *   - Otherwise idle → `idle`
 *
 * @param {object} session - Session record (read-only)
 * @returns {string} One of: 'running', 'done', 'interrupted', 'idle'
 */
function deriveBadge(session) {
  const { state, recentEvents } = session;
  const tail = recentEvents.slice(-3);

  // No events at all → idle
  if (tail.length === 0) return 'idle';

  const lastType = tail[tail.length - 1].type;

  // Active processing states → running
  if (state === 'working'   ||
      state === 'thinking'  ||
      state === 'juggling'  ||
      state === 'attention' ||
      state === 'notification') {
    return 'running';
  }

  // Sleeping → idle
  if (state === 'sleeping') return 'idle';

  // Idle — check how we arrived here
  if (state === 'idle') {
    if (lastType === 'Stop') {
      // If background tasks are still active, the session isn't really done
      return session._backgroundTasks > 0 ? 'running' : 'interrupted';
    }
    return 'idle';
  }

  return 'idle';
}

/**
 * Resolve the global pet display state from a collection of sessions.
 *
 * Iterates all sessions and returns the state with the highest display
 * priority:
 *   notification > attention > working > thinking > juggling > idle > sleeping
 *
 * Used to decide what "mood" or "activity" indicator the desktop pet should
 * show when multiple sessions exist simultaneously.
 *
 * @param {object[]|object<string,object>} sessions - Array of session objects,
 *        or an object map keyed by session ID (from getSnapshot().sessions).
 * @returns {string} The highest-priority state found, or `'sleeping'` if empty.
 */
function resolvePetDisplayState(sessions) {
  if (!sessions) return 'sleeping';

  const iterable = Array.isArray(sessions)
    ? sessions
    : Object.values(sessions);

  if (iterable.length === 0) return 'sleeping';

  for (const state of STATE_PRIORITY) {
    for (const s of iterable) {
      if (s && s.state === state) return state;
    }
  }

  return 'sleeping';
}

// ─── State Manager Factory ───────────────────────────────────────────────────

/**
 * Create a session state manager instance.
 *
 * Manages a collection of Claude Code sessions with lifecycle-aware state
 * transitions, process-liveness checks, and event tracking.
 *
 * @returns {object} State manager API:
 *   - updateSession(sessionId, state?, event?, opts?)
 *   - getSnapshot()
 *   - cleanStaleSessions()
 *   - getAllSessions()
 *   - getSession(sessionId)
 */
function createStateManager() {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  /** @type {string[]} Insertion-order array. */
  const orderedIds = [];

  // ─── Internal helpers ────────────────────────────────────────────────

  /**
   * Get an existing session or create a new default record.
   *
   * @param {string} id
   * @returns {object} Session record (live reference — mutate with care)
   */
  function ensureSession(id) {
    let session = sessions.get(id);
    if (!session) {
      session = createDefaultSession(id);
      sessions.set(id, session);
      orderedIds.push(id);
    }
    return session;
  }

  /**
   * Remove a session from tracking entirely.
   *
   * @param {string} id
   */
  function deleteSession(id) {
    sessions.delete(id);
    const idx = orderedIds.indexOf(id);
    if (idx !== -1) orderedIds.splice(idx, 1);
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Central dispatch for session updates.
   *
   * Every call (except `SessionEnd`) creates the session if it doesn't exist.
   * Events are appended to `recentEvents` (capped at the last 20), the
   * state is updated (either from the explicit `state` argument or derived
   * from the event type), and the badge is re-derived from the event tail.
   *
   * @param {string}        sessionId  - Session to update
   * @param {string}        [state]    - New session state. If omitted, the state
   *                                     is auto-derived from `event.type`. If
   *                                     provided, the caller explicitly controls
   *                                     the transition.
   * @param {string|object} [event]    - Event to record. Either a string (event
   *                                     type) or an object `{ type, data?, timestamp? }`.
   * @param {object}        [opts]     - Additional session-field overrides.
   *   Recognised keys: agentId, sessionTitle, cwd, model, provider, host,
   *   wslDistro, headless, platform, contextUsage, agentPid, sourcePid,
   *   requiresCompletionAck, displayHint, resumeState.
   *   Special key `force: true` bypasses the Stop completion gate.
   *
   * Special event handling:
   *   - `SubagentStart`  — increments the background-task counter (pushes juggling)
   *   - `SubagentStop`   — decrements the counter
   *   - `SessionEnd`     — deletes the session immediately (no state change)
   *   - `Stop`           — completion gate: if background tasks are active, keeps
   *                        the state at `working` unless `opts.force === true`
   */
  function updateSession(sessionId, state, event, opts) {
    // ── Normalise event ────────────────────────────────────────────────
    let eventType = null;
    let eventData = {};
    let eventTimestamp = null;

    if (event) {
      if (typeof event === 'string') {
        eventType = event;
      } else if (typeof event === 'object' && event !== null) {
        eventType = event.type || null;
        eventData = event.data || {};
        eventTimestamp = event.timestamp || null;
      }
    }

    // ── SessionEnd → delete immediately, no further processing ────────
    if (eventType === 'SessionEnd') {
      const existing = sessions.get(sessionId);
      if (existing) {
        // Record the termination event before removal
        existing.recentEvents.push({
          type: 'SessionEnd',
          timestamp: eventTimestamp || Date.now(),
          data: eventData,
        });
        existing.updatedAt = Date.now();
      }
      deleteSession(sessionId);
      return;
    }

    // ── Ensure session exists ──────────────────────────────────────────
    const session = ensureSession(sessionId);

    // ── Record event ───────────────────────────────────────────────────
    if (eventType) {
      session.recentEvents.push({
        type: eventType,
        timestamp: eventTimestamp || Date.now(),
        data: eventData,
      });
      // Keep only the last N events
      if (session.recentEvents.length > MAX_RECENT_EVENTS) {
        session.recentEvents = session.recentEvents.slice(-MAX_RECENT_EVENTS);
      }

      // ── Event-specific side effects ──────────────────────────────────
      switch (eventType) {
        case 'SubagentStart':
          session._backgroundTasks += 1;
          // When a subagent starts, always transition to juggling
          // (unless the caller provided an explicit state override)
          if (!state) session.state = 'juggling';
          break;

        case 'SubagentStop':
          session._backgroundTasks = Math.max(0, session._backgroundTasks - 1);
          // On SubagentStop, the caller may provide a state to return to.
          // If not provided, leave the state as-is (the caller should handle it).
          break;

        case 'Stop': {
          // ── Completion gate ────────────────────────────────────────────
          // If background tasks are still running, don't let the session
          // slide into idle/done — keep it in working state so the badge
          // stays "running". The caller can force-complete with opts.force.
          const bgActive = session._backgroundTasks > 0;
          if (bgActive && !(opts && opts.force)) {
            // Force working regardless of what `state` or EVENT_TO_STATE says
            session.state = 'working';
          }
          break;
        }

        case 'PostToolUse':
        case 'PostToolUseFailure':
          // These events never auto-derive a state; the caller must
          // provide an explicit `state` argument or accept the current one.
          // However, if the current state is 'thinking' (from PreToolUse)
          // and a PostToolUse arrives, move back to 'working'.
          if (!state && eventType === 'PostToolUse' && session.state === 'thinking') {
            session.state = 'working';
          }
          if (!state && eventType === 'PostToolUseFailure' && session.state === 'thinking') {
            session.state = 'working';
          }
          break;

        default:
          break;
      }
    }

    // ── Resolve session state ──────────────────────────────────────────
    // Only apply state changes if the event-specific handlers above haven't
    // already forced a state (e.g. SubagentStart, Stop gate).
    const gateOverrode = (eventType === 'Stop' &&
                          session.state === 'working' &&
                          session._backgroundTasks > 0 &&
                          !(opts && opts.force));
    const subagentOverrode = (eventType === 'SubagentStart' && !state);

    if (!gateOverrode && !subagentOverrode) {
      if (state && VALID_STATES.has(state)) {
        session.state = state;
      } else if (eventType && !state) {
        // Auto-derive from event type
        const derived = EVENT_TO_STATE[eventType];
        if (derived && VALID_STATES.has(derived)) {
          session.state = derived;
        }
      }
    }
    // else: both null/undefined — leave state unchanged

    // ── Update badge ───────────────────────────────────────────────────
    session.badge = deriveBadge(session);

    // ── Apply optional field overrides ─────────────────────────────────
    if (opts && typeof opts === 'object') {
      // Whitelist of fields that may be set via opts
      const FIELD_MAP = {
        agentId:             1,
        sessionTitle:        1,
        cwd:                 1,
        model:               1,
        provider:            1,
        host:                1,
        wslDistro:           1,
        headless:            1,
        platform:            1,
        agentPid:            1,
        sourcePid:           1,
        requiresCompletionAck: 1,
        displayHint:         1,
        resumeState:         1,
      };

      for (const key of Object.keys(opts)) {
        if (key === 'force') continue;             // internal control flag
        if (key === 'contextUsage') continue;      // handled separately
        if (FIELD_MAP[key] && opts[key] !== undefined) {
          session[key] = opts[key];
        }
      }

      // Validate and sanitise contextUsage shape
      if (opts.contextUsage !== undefined) {
        const cu = opts.contextUsage;
        if (!cu || typeof cu !== 'object') {
          session.contextUsage = { used: 0, limit: 0, percent: 0 };
        } else {
          session.contextUsage = {
            used:    Number.isFinite(cu.used)    ? cu.used    : 0,
            limit:   Number.isFinite(cu.limit)   ? cu.limit   : 0,
            percent: Number.isFinite(cu.percent) ? cu.percent : 0,
          };
        }
      }
    }

    // ── Check PID reachability ──────────────────────────────────────────
    session.pidReachable = isProcessAlive(session.agentPid || session.sourcePid);

    // ── Update timestamp ───────────────────────────────────────────────
    session.updatedAt = Date.now();
  }

  /**
   * Return a serialisable snapshot of all tracked sessions.
   *
   * Sessions are grouped into:
   *   - `foreground` / `headless` (by the session's `headless` flag)
   *   - `provider:<name>` (one group per unique provider value)
   *   - `host:<host>` (one group per unique host value)
   *
   * @returns {{ sessions: object<string,object>, orderedIds: string[], groups: object }}
   */
  function getSnapshot() {
    /** @type {object<string,object>} */
    const snapshot = {};
    for (const [id, s] of sessions) {
      snapshot[id] = Object.assign({}, s);
    }

    // Derive groups from session attributes
    /** @type {object<string,string[]>} */
    const groups = {};
    for (const [id, s] of sessions) {
      // Group by headless vs foreground
      const hgKey = s.headless ? 'headless' : 'foreground';
      if (!groups[hgKey]) groups[hgKey] = [];
      groups[hgKey].push(id);

      // Group by provider (if set)
      if (s.provider) {
        const provKey = 'provider:' + s.provider;
        if (!groups[provKey]) groups[provKey] = [];
        groups[provKey].push(id);
      }

      // Group by host (if set)
      if (s.host) {
        const hostKey = 'host:' + s.host;
        if (!groups[hostKey]) groups[hostKey] = [];
        groups[hostKey].push(id);
      }
    }

    return {
      sessions: snapshot,
      orderedIds: orderedIds.slice(), // defensive copy
      groups,
    };
  }

  /**
   * Check all tracked sessions for process liveness.
   *
   * Iterates every session, checks its `agentPid` (falling back to
   * `sourcePid`) via signal-0. If the PID is unreachable, marks the session
   * as `sleeping` with `badge: 'interrupted'` and `pidReachable: false`.
   *
   * @returns {string[]} IDs of sessions that were marked stale
   */
  function cleanStaleSessions() {
    /** @type {string[]} */
    const staleIds = [];

    for (const [id, s] of sessions) {
      const pid = s.agentPid || s.sourcePid;
      if (pid && !isProcessAlive(pid)) {
        s.state = 'sleeping';
        s.badge = 'interrupted';
        s.pidReachable = false;
        s.updatedAt = Date.now();
        staleIds.push(id);
      }
    }

    return staleIds;
  }

  /**
   * Return a shallow copy of all session objects (safe for serialisation).
   *
   * @returns {object[]}
   */
  function getAllSessions() {
    return Array.from(sessions.values()).map(s => Object.assign({}, s));
  }

  /**
   * Return a shallow copy of a single session, or null if not found.
   *
   * @param {string} sessionId
   * @returns {object|null}
   */
  function getSession(sessionId) {
    const s = sessions.get(sessionId);
    return s ? Object.assign({}, s) : null;
  }

  // ── Export ────────────────────────────────────────────────────────────
  return {
    updateSession,
    getSnapshot,
    cleanStaleSessions,
    getAllSessions,
    getSession,
  };
}

// ─── Module Exports ──────────────────────────────────────────────────────────

module.exports = {
  createStateManager,
  isProcessAlive,
  resolvePetDisplayState,
  // Constants for external consumers
  STATE_PRIORITY:       STATE_PRIORITY.slice(),
  VALID_STATES:         Array.from(VALID_STATES),
  VALID_BADGES:         VALID_BADGES.slice(),
  EVENT_TO_STATE:       Object.freeze(Object.assign({}, EVENT_TO_STATE)),
  MAX_RECENT_EVENTS,
};
