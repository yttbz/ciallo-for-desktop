/**
 * src/bubble-renderer.js — Permission bubble rendering and interaction
 *
 * Renders permission requests in the bubble UI and handles user decisions.
 * Communicates with the main process via window.bubbleAPI (exposed by preload-bubble.js).
 *
 * @module src/bubble-renderer
 */

'use strict';

(function () {
  // ─── DOM References ──────────────────────────────────────────────────────────

  /** @type {object} */
  var dom = {};

  function cacheDom() {
    dom.container      = document.getElementById('bubbleContainer');
    dom.emptyState     = document.getElementById('emptyState');
    dom.content        = document.getElementById('permissionContent');
    dom.sourceBadge    = document.getElementById('sourceBadge');
    dom.toolBadge      = document.getElementById('toolBadge');
    dom.toolName       = document.getElementById('toolName');
    dom.agentId        = document.getElementById('agentId');
    dom.commandText    = document.getElementById('commandText');
    dom.metaCwd        = document.getElementById('metaCwd');
    dom.metaTime       = document.getElementById('metaTime');
    dom.countdownFill  = document.getElementById('countdownFill');
    dom.countdownSec   = document.getElementById('countdownSec');
    dom.btnAllow       = document.getElementById('btnAllow');
    dom.btnAlwaysAllow = document.getElementById('btnAlwaysAllow');
    dom.btnDeny        = document.getElementById('btnDeny');
  }

  // ─── State ───────────────────────────────────────────────────────────────────

  /** Current permission entry being displayed. */
  var currentEntry = null;

  /** Countdown interval handle. */
  var countdownInterval = null;

  /** Permission timeout (ms), synced from main process. */
  var permissionTimeout = 120000;

  // ─── Icon map for tool names ─────────────────────────────────────────────────

  var TOOL_ICONS = {
    bash:       '🔨',  // 🔨
    execute:    '▶',        // ▶
    read:       '📖',  // 📖
    write:      '✏',        // ✏
    edit:       '✏',        // ✏
    search:     '🔍',  // 🔍
    web_search: '🌐',  // 🌐
    web_fetch:  '🌐',  // 🌐
    monitor:    '📊',  // 📊
    agent:      '🤖',  // 🤖
    think:      '🧠',  // 🧠
    default:    '⚙',        // ⚙
  };

  /**
   * Get the icon for a tool name.
   *
   * @param {string} toolName
   * @returns {string} Emoji icon
   */
  function getToolIcon(toolName) {
    if (!toolName || typeof toolName !== 'string') return TOOL_ICONS.default;
    var key = toolName.toLowerCase().replace(/[^a-z_]/g, '');
    return TOOL_ICONS[key] || TOOL_ICONS.default;
  }

  // ─── Formatting helpers ──────────────────────────────────────────────────────

  /**
   * Format a timestamp to locale time string.
   *
   * @param {number} ts - Unix timestamp in milliseconds
   * @returns {string}
   */
  function formatTime(ts) {
    try {
      var d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '--:--:--';
    }
  }

  /**
   * Truncate a string to a maximum length, appending ellipsis if needed.
   *
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function truncate(str, maxLen) {
    if (typeof str !== 'string') return '';
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '...';
  }

  /**
   * Escape HTML entities in a string.
   *
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── UI rendering ────────────────────────────────────────────────────────────

  /**
   * Render a permission entry in the bubble.
   *
   * @param {object} entry - Permission entry from main process
   */
  function renderPermission(entry) {
    if (!entry) {
      showEmptyState();
      return;
    }

    currentEntry = entry;

    // Hide empty state, show content
    dom.emptyState.style.display = 'none';
    dom.content.style.display = 'block';

    // Source badge
    dom.sourceBadge.textContent = entry.source || 'claude';

    // Tool badge
    var icon = getToolIcon(entry.toolName);
    dom.toolBadge.innerHTML = '<span>' + icon + '</span><span>' + escapeHtml(entry.toolName || 'Tool') + '</span>';

    // Agent ID
    dom.agentId.textContent = truncate(entry.agentId || 'unknown', 32);

    // Command
    dom.commandText.textContent = entry.command || '';

    // Metadata
    dom.metaCwd.textContent = truncate(entry.cwd || '--', 48);
    dom.metaTime.textContent = formatTime(entry.timestamp || Date.now());

    // Enable buttons
    dom.btnAllow.disabled = false;
    dom.btnAlwaysAllow.disabled = false;
    dom.btnDeny.disabled = false;

    // Focus allow button for keyboard accessibility
    dom.btnAllow.focus();

    // Start countdown
    startCountdown(entry.timestamp || Date.now());

    // Report content height to main process for window resize
    reportHeight();
  }

  /**
   * Show the empty/waiting state.
   */
  function showEmptyState() {
    dom.emptyState.style.display = 'flex';
    dom.content.style.display = 'none';
    dom.btnAllow.disabled = true;
    dom.btnAlwaysAllow.disabled = true;
    dom.btnDeny.disabled = true;
    stopCountdown();
    reportHeight();
  }

  /**
   * Report the bubble's content height to the main process.
   */
  function reportHeight() {
    if (window.bubbleAPI && typeof window.bubbleAPI.reportHeight === 'function') {
      var height = document.body.scrollHeight;
      window.bubbleAPI.reportHeight(height);
    }
  }

  // ─── Countdown ───────────────────────────────────────────────────────────────

  /**
   * Start the auto-deny countdown timer.
   *
   * @param {number} startTimestamp - When the permission was created
   */
  function startCountdown(startTimestamp) {
    stopCountdown();

    countdownInterval = setInterval(function () {
      var elapsed = Date.now() - startTimestamp;
      var remaining = Math.max(0, permissionTimeout - elapsed);
      var sec = Math.ceil(remaining / 1000);
      var percent = (remaining / permissionTimeout) * 100;

      dom.countdownSec.textContent = sec;
      dom.countdownFill.style.width = percent + '%';

      if (remaining <= 0) {
        stopCountdown();
        clearPermission();
      }
    }, 200);
  }

  /**
   * Stop the countdown timer.
   */
  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  /**
   * Clear the current permission display.
   */
  function clearPermission() {
    currentEntry = null;
    showEmptyState();
  }

  // ─── Decision handling ───────────────────────────────────────────────────────

  /**
   * Send a decision to the main process.
   *
   * @param {string} decision - 'allowed', 'denied', or 'always_allowed'
   */
  function decide(decision) {
    if (!currentEntry) return;

    if (window.bubbleAPI && typeof window.bubbleAPI.decide === 'function') {
      window.bubbleAPI.decide(currentEntry.id, decision);
    }

    clearPermission();
  }

  // ─── Event binding ───────────────────────────────────────────────────────────

  /**
   * Bind click handlers to action buttons.
   */
  function bindEvents() {
    dom.btnAllow.addEventListener('click', function () {
      decide('allowed');
    });

    dom.btnAlwaysAllow.addEventListener('click', function () {
      decide('always_allowed');
    });

    dom.btnDeny.addEventListener('click', function () {
      decide('denied');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Ignore if IME is active (CJK input)
      if (e.isComposing || e.keyCode === 229) return;

      switch (e.key) {
        case 'Enter':
        case 'y':
        case 'Y':
          decide('allowed');
          e.preventDefault();
          break;
        case 'a':
        case 'A':
          decide('always_allowed');
          e.preventDefault();
          break;
        case 'n':
        case 'N':
        case 'Escape':
          decide('denied');
          e.preventDefault();
          break;
      }
    });
  }

  // ─── Window resize observer ──────────────────────────────────────────────────

  /**
   * Observe resize of the container and report height.
   */
  function observeResize() {
    if (window.ResizeObserver) {
      try {
        var observer = new ResizeObserver(function () {
          reportHeight();
        });
        observer.observe(document.body);
      } catch (_) {
        // ResizeObserver not available
      }
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────────────

  function init() {
    cacheDom();
    bindEvents();
    observeResize();

    // Listen for permission show events from main process
    if (window.bubbleAPI && typeof window.bubbleAPI.onPermissionShow === 'function') {
      window.bubbleAPI.onPermissionShow(function (entry) {
        renderPermission(entry);
      });
    }

    // Listen for permission hide events from main process
    if (window.bubbleAPI && typeof window.bubbleAPI.onPermissionHide === 'function') {
      window.bubbleAPI.onPermissionHide(function () {
        clearPermission();
      });
    }

    // Report initial height
    reportHeight();
  }

  // ─── DOM Ready ────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
