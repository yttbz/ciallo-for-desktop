/**
 * src/session-hud-renderer.js — Session HUD DOM Rendering
 *
 * Receives session snapshot data from the main process via
 * window.sessionHudAPI and renders a compact list of active sessions.
 *
 * Features:
 *   - Session rows with status dot, state chip, usage chip, elapsed time
 *   - Title truncation (character-width-aware, ~15 units max)
 *   - Folded row when >4 sessions (+N other sessions → open dashboard)
 *   - Pin button (SVG pushpin icon)
 *   - 1-second elapsed-time update interval
 *   - Click to focus session, click folded row to open dashboard
 *   - Respects prefers-reduced-motion
 *
 * @module session-hud-renderer
 */

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────

  /** Maps session state → human-readable (Chinese) label. */
  var STATE_LABELS = {
    thinking:     '思考中',
    working:      '工作中',
    juggling:     '多任务',
    notification: '通知',
    attention:    '注意',
    idle:         '空闲',
    sleeping:     '休眠',
  };

  /** Badge → status dot colour. */
  var BADGE_COLORS = {
    running:     '#22c55e',
    done:        '#3b82f6',
    interrupted: '#f59e0b',
    idle:        '#6b7280',
  };

  /** State → chip background / text colour. */
  var STATE_CHIP_STYLE = {
    thinking:     { bg: '#1e3a5f', fg: '#60a5fa' },
    working:      { bg: '#1e3a1f', fg: '#4ade80' },
    juggling:     { bg: '#3a1e5f', fg: '#c084fc' },
    notification: { bg: '#5f1e1e', fg: '#f87171' },
    attention:    { bg: '#5f4a1e', fg: '#fbbf24' },
    idle:         { bg: '#1f2937', fg: '#9ca3af' },
    sleeping:     { bg: '#111827', fg: '#6b7280' },
  };

  var ELAPSED_INTERVAL = 1000; // 1 s
  var MAX_TITLE_UNITS = 15;

  /** Max visible sessions before folding. */
  var MAX_VISIBLE = 4;

  // ─── State Variables ──────────────────────────────────────────────────

  /** @type {object|null} */
  var currentSnapshot = null;

  /** @type {number|null} */
  var timerHandle = null;

  /** @type {boolean} */
  var isPinned = false;

  /** @type {boolean} */
  var isFirstSnapshot = true;

  // ─── DOM Refs ─────────────────────────────────────────────────────────

  /** @type {HTMLElement|null} */
  var listEl = document.getElementById('session-list');

  /** @type {HTMLElement|null} */
  var emptyEl = document.getElementById('empty-state');

  /** @type {HTMLElement|null} */
  var pinBtn = document.getElementById('pin-button');

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Character-width-aware title truncation.
   *
   * CJK characters count as 2 units, Latin/digit/punct as 1 unit.
   * Appends '…' when truncation occurs.
   *
   * @param {string} str
   * @param {number} [maxUnits=MAX_TITLE_UNITS]
   * @returns {string}
   */
  function truncateTitle(str, maxUnits) {
    if (!str) return '';
    maxUnits = maxUnits || MAX_TITLE_UNITS;
    var units = 0;
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      var w = /[一-鿿　-ヿ＀-￯]/.test(ch) ? 2 : 1;
      if (units + w > maxUnits) {
        result += '…'; // …
        break;
      }
      result += ch;
      units += w;
    }
    return result;
  }

  /**
   * Format an elapsed duration from a UNIX-millisecond timestamp.
   *
   * @param {number} updatedAt  — Date.now() value
   * @returns {string}  e.g. "3s", "45s", "2m 12s", "1h 5m", "3d"
   */
  function formatElapsed(updatedAt) {
    var diff = Math.floor((Date.now() - updatedAt) / 1000);
    if (diff < 0) return '0s';
    if (diff < 60) return diff + 's';
    if (diff < 3600) {
      var m = Math.floor(diff / 60);
      var s = diff % 60;
      return m + 'm ' + s + 's';
    }
    if (diff < 86400) {
      var h = Math.floor(diff / 3600);
      var min = Math.floor((diff % 3600) / 60);
      return h + 'h ' + min + 'm';
    }
    return Math.floor(diff / 86400) + 'd';
  }

  /**
   * Create the pushpin SVG icon element.
   *
   * @param {boolean} pinned
   * @returns {SVGElement}
   */
  function createPinSvg(pinned) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', pinned ? '#60a5fa' : '#6b7280');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2L15 9L22 9L16 13L18 20L12 16L6 20L8 13L2 9L9 9L12 2Z');
    svg.appendChild(path);

    return svg;
  }

  // ─── DOM Builders ─────────────────────────────────────────────────────

  /**
   * Build a status-dot <span>.
   *
   * @param {string} badge  — one of 'running', 'done', 'interrupted', 'idle'
   * @returns {HTMLSpanElement}
   */
  function createStatusDot(badge) {
    var dot = document.createElement('span');
    dot.className = 'status-dot';
    var color = BADGE_COLORS[badge] || BADGE_COLORS.idle;
    dot.style.backgroundColor = color;
    dot.style.boxShadow = '0 0 4px ' + color;

    if (badge === 'running') {
      dot.classList.add('pulse');
      dot.style.animation = 'dot-pulse 2s ease-in-out infinite';
    }
    return dot;
  }

  /**
   * Build a state-chip <span>.
   *
   * @param {string} state  — one of the known states
   * @returns {HTMLSpanElement}
   */
  function createStateChip(state) {
    var chip = document.createElement('span');
    chip.className = 'state-chip';
    var style = STATE_CHIP_STYLE[state] || STATE_CHIP_STYLE.idle;
    chip.textContent = STATE_LABELS[state] || state;
    chip.style.backgroundColor = style.bg;
    chip.style.color = style.fg;
    return chip;
  }

  /**
   * Build a usage-percentage chip <span>.
   *
   * Color thresholds:
   *   >= 90%  red
   *   >= 75%  amber
   *   <  75%  gray
   *
   * @param {number} percent
   * @returns {HTMLSpanElement|null}  null if percent <= 0
   */
  function createUsageChip(percent) {
    var p = (typeof percent === 'number' && isFinite(percent)) ? percent : 0;
    if (p <= 0) return null;

    var chip = document.createElement('span');
    chip.className = 'usage-chip';
    chip.textContent = Math.round(p) + '%';

    if (p >= 90) {
      chip.style.backgroundColor = '#5f1e1e';
      chip.style.color = '#f87171';
    } else if (p >= 75) {
      chip.style.backgroundColor = '#5f4a1e';
      chip.style.color = '#fbbf24';
    } else {
      chip.style.backgroundColor = '#1f2937';
      chip.style.color = '#9ca3af';
    }
    return chip;
  }

  /**
   * Build the elapsed-time <span>.
   *
   * @param {number} updatedAt  — timestamp in ms
   * @returns {HTMLSpanElement}
   */
  function createTimeEl(updatedAt) {
    var el = document.createElement('span');
    el.className = 'elapsed-time';
    el.dataset.updatedAt = String(updatedAt);
    el.textContent = formatElapsed(updatedAt);
    return el;
  }

  /**
   * Build a full session row.
   *
   * Structure:
   *   .session-row
   *     .row-left   → status-dot
   *     .row-middle → .row-title + .row-meta (state-chip [+ usage-chip])
   *     .row-right  → elapsed-time
   *
   * @param {object} session  — session record from snapshot
   * @returns {HTMLDivElement}
   */
  function createSessionRow(session) {
    var row = document.createElement('div');
    row.className = 'session-row';
    row.dataset.sessionId = session.id;

    // Left column: status dot
    var left = document.createElement('div');
    left.className = 'row-left';
    left.appendChild(createStatusDot(session.badge || 'idle'));
    row.appendChild(left);

    // Middle column: title + meta chips
    var mid = document.createElement('div');
    mid.className = 'row-middle';

    var title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = truncateTitle(
      session.sessionTitle || session.agentId || session.id,
      MAX_TITLE_UNITS
    );
    mid.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'row-meta';
    meta.appendChild(createStateChip(session.state || 'idle'));

    if (session.contextUsage) {
      var usageChip = createUsageChip(session.contextUsage.percent);
      if (usageChip) meta.appendChild(usageChip);
    }

    mid.appendChild(meta);
    row.appendChild(mid);

    // Right column: elapsed time
    var right = document.createElement('div');
    right.className = 'row-right';
    right.appendChild(createTimeEl(session.updatedAt || Date.now()));
    row.appendChild(right);

    return row;
  }

  /**
   * Build a folded row showing how many sessions are hidden.
   *
   * @param {number} count  — number of hidden sessions
   * @returns {HTMLDivElement}
   */
  function createFoldedRow(count) {
    var row = document.createElement('div');
    row.className = 'session-row folded-row';
    row.dataset.folded = 'true';

    var label = document.createElement('span');
    label.textContent = '+' + count + ' 个其他会话';

    var icon = document.createElement('span');
    icon.className = 'folded-icon';
    icon.textContent = '→'; // →

    row.appendChild(label);
    row.appendChild(icon);

    return row;
  }

  // ─── Render ───────────────────────────────────────────────────────────

  /**
   * Full re-render from the current snapshot.
   *
   * Shows the empty-state placeholder when there are no sessions,
   * otherwise builds session rows (max MAX_VISIBLE, rest folded).
   */
  function render() {
    if (!listEl || !emptyEl) return;

    var hasSessions = (
      currentSnapshot &&
      Array.isArray(currentSnapshot.orderedIds) &&
      currentSnapshot.orderedIds.length > 0
    );

    if (!hasSessions) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';

    var sessions = currentSnapshot.sessions || {};
    var orderedIds = currentSnapshot.orderedIds;
    var showIds = orderedIds.slice(0, MAX_VISIBLE);
    var hiddenCount = orderedIds.length > MAX_VISIBLE
      ? orderedIds.length - MAX_VISIBLE
      : 0;

    var fragment = document.createDocumentFragment();

    for (var i = 0; i < showIds.length; i++) {
      var s = sessions[showIds[i]];
      if (s) {
        fragment.appendChild(createSessionRow(s));
      }
    }

    if (hiddenCount > 0) {
      fragment.appendChild(createFoldedRow(hiddenCount));
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  // ─── Elapsed Time Updater ─────────────────────────────────────────────

  /** Refresh all elapsed-time spans in the list. */
  function updateElapsedTimes() {
    var els = listEl ? listEl.querySelectorAll('.elapsed-time') : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var ts = parseInt(el.dataset.updatedAt, 10);
      if (!isNaN(ts)) {
        el.textContent = formatElapsed(ts);
      }
    }
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(updateElapsedTimes, ELAPSED_INTERVAL);
  }

  function stopTimer() {
    if (timerHandle !== null) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  // ─── Pin Button ───────────────────────────────────────────────────────

  function updatePinButton() {
    if (!pinBtn) return;

    // Clear existing content
    while (pinBtn.firstChild) {
      pinBtn.removeChild(pinBtn.firstChild);
    }

    pinBtn.appendChild(createPinSvg(isPinned));
    pinBtn.title = isPinned ? '取消固定' : '固定';
    pinBtn.classList.toggle('pinned', isPinned);
  }

  function handlePinClick(e) {
    e.stopPropagation();
    isPinned = !isPinned;
    updatePinButton();

    if (window.sessionHudAPI && typeof window.sessionHudAPI.setPinned === 'function') {
      window.sessionHudAPI.setPinned(isPinned);
    }
  }

  // ─── Click Delegation ─────────────────────────────────────────────────

  function handleListClick(e) {
    var row = e.target.closest('.session-row');
    if (!row) return;

    // Folded row → open dashboard
    if (row.dataset.folded === 'true') {
      if (window.sessionHudAPI && typeof window.sessionHudAPI.openDashboard === 'function') {
        window.sessionHudAPI.openDashboard();
      }
      return;
    }

    // Regular session row → focus session
    var sessionId = row.dataset.sessionId;
    if (sessionId && window.sessionHudAPI && typeof window.sessionHudAPI.focusSession === 'function') {
      window.sessionHudAPI.focusSession(sessionId);
    }
  }

  // ─── Preload API Bridge ───────────────────────────────────────────────

  function setupAPIListeners() {
    var api = window.sessionHudAPI;
    if (!api) {
      console.warn('[SessionHUD Renderer] sessionHudAPI not available');
      return;
    }

    // Subscribe to snapshot updates
    if (typeof api.onSessionSnapshot === 'function') {
      api.onSessionSnapshot(function (snapshot) {
        currentSnapshot = snapshot;
        isFirstSnapshot = false;
        render();
        startTimer();
      });
    }

    // Subscribe to language changes → re-render titles / labels
    if (typeof api.onLangChange === 'function') {
      api.onLangChange(function () {
        if (currentSnapshot) render();
      });
    }
  }

  // ─── Initialization ───────────────────────────────────────────────────

  function init() {
    // Pin button
    if (pinBtn) {
      pinBtn.addEventListener('click', handlePinClick);
    }
    updatePinButton();

    // Click delegation on session list
    if (listEl) {
      listEl.addEventListener('click', handleListClick);
    }

    // Wire up preload API
    setupAPIListeners();

    // Respect prefers-reduced-motion
    var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var setReducedMotion = function (matches) {
      document.documentElement.classList.toggle('reduced-motion', matches);
    };
    setReducedMotion(motionQuery.matches);
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', function (e) {
        setReducedMotion(e.matches);
      });
    }
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
