/**
 * main/permission.js — Permission manager for Claude Code tool execution
 *
 * Manages pending permission requests from Claude Code subagents.
 * Creates a transient BrowserWindow (bubble) to display each request
 * and captures the user's allow/deny/always-allow decision.
 *
 * The bubble is a small, frameless, always-on-top window positioned
 * near the desktop pet.
 *
 * @module main/permission
 */

'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Bubble window width (px). */
const BUBBLE_WIDTH = 420;

/** Bubble window height (px) — auto-resized via IPC. */
const BUBBLE_HEIGHT = 280;

/** Timeout for pending permission (ms) — auto-deny after this. */
const PERMISSION_TIMEOUT = 120000; // 2 minutes

/** Maximum number of pending permissions kept in memory. */
const MAX_PENDING_PERMISSIONS = 100;

// ─── Permission Manager Factory ───────────────────────────────────────────────

/**
 * Create a permission manager instance.
 *
 * @param {object} ctx - Context
 * @param {function} ctx.log - Logger function
 * @param {function} [ctx.getParentWindow] - Returns parent BrowserWindow (for bubble positioning)
 * @param {function} [ctx.onPermissionResult] - Callback when a permission is resolved
 *        (permissionId, decision, entry) => void
 * @returns {object} Permission manager API
 */
function createPermissionManager(ctx) {
  if (!ctx || typeof ctx.log !== 'function') {
    throw new TypeError('createPermissionManager requires ctx.log function');
  }

  var log = ctx.log;
  var getParentWindow = (typeof ctx.getParentWindow === 'function')
    ? ctx.getParentWindow
    : function () { return null; };
  var onPermissionResult = (typeof ctx.onPermissionResult === 'function')
    ? ctx.onPermissionResult
    : function () {};

  /**
   * Active permission requests.
   * Map<permissionId, { entry, timer, bubbleWin }>
   * @type {Map<string, object>}
   */
  var pendingPermissions = new Map();

  /** @type {BrowserWindow|null} */
  var currentBubbleWindow = null;

  /** Permission ID counter. */
  var nextId = 1;

  // ── Bubble window management ─────────────────────

  /**
   * Get the ideal position for the bubble window.
   *
   * If a parent window exists, positions the bubble to its bottom-right.
   * Otherwise, centers on the primary display.
   *
   * @returns {{ x: number, y: number }}
   */
  function getBubblePosition() {
    var parentWin = getParentWindow();

    if (parentWin && !parentWin.isDestroyed()) {
      var parentBounds = parentWin.getBounds();
      return {
        x: Math.round(parentBounds.x + parentBounds.width + 10),
        y: Math.round(parentBounds.y + parentBounds.height - BUBBLE_HEIGHT - 20),
      };
    }

    // Fallback: center on primary display
    var primaryDisplay = screen.getPrimaryDisplay();
    var workArea = primaryDisplay.workAreaSize;
    return {
      x: Math.round((workArea.width - BUBBLE_WIDTH) / 2),
      y: Math.round((workArea.height - BUBBLE_HEIGHT) / 2),
    };
  }

  /**
   * Create or reuse the bubble BrowserWindow.
   *
   * @returns {BrowserWindow}
   */
  function createBubbleWindow() {
    if (currentBubbleWindow && !currentBubbleWindow.isDestroyed()) {
      return currentBubbleWindow;
    }

    var pos = getBubblePosition();

    var win = new BrowserWindow({
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      x: pos.x,
      y: pos.y,
      transparent: false,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: true,
      show: false,
      backgroundColor: '#1a1a2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload-bubble.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.loadFile(path.join(__dirname, '..', 'src', 'bubble.html'));

    // Prevent the bubble from being closed by accident
    win.on('close', function (event) {
      // Don't prevent close on app quit
      event.preventDefault();
      win.hide();
    });

    // Clean up when destroyed
    win.on('closed', function () {
      currentBubbleWindow = null;
    });

    currentBubbleWindow = win;
    return win;
  }

  /**
   * Show the bubble window and send permission data.
   *
   * @param {object} entry - Permission entry
   */
  function showBubble(entry) {
    try {
      var win = createBubbleWindow();

      // Wait for the window to be ready before sending data
      if (win.isVisible()) {
        win.webContents.send('permission-show', entry);
        win.focus();
      } else {
        win.once('ready-to-show', function () {
          win.webContents.send('permission-show', entry);
          win.show();
          win.focus();
        });
        win.show();
      }
    } catch (err) {
      log('[Permission] Failed to show bubble: ' + err.message);
    }
  }

  /**
   * Hide and clear the bubble window.
   */
  function hideBubble() {
    if (currentBubbleWindow && !currentBubbleWindow.isDestroyed()) {
      currentBubbleWindow.hide();
    }
  }

  /**
   * Reposition the bubble window (e.g., after parent window moves).
   */
  function repositionBubble() {
    if (currentBubbleWindow && !currentBubbleWindow.isDestroyed()) {
      var pos = getBubblePosition();
      currentBubbleWindow.setPosition(pos.x, pos.y);
    }
  }

  // ── Permission lifecycle ─────────────────────────

  /**
   * Create a new pending permission request.
   *
   * @param {string} agentId - Agent identifier
   * @param {string} toolName - Tool being executed
   * @param {string} command - Full command string
   * @param {object} [options]
   * @param {string} [options.cwd] - Working directory
   * @param {string} [options.source] - Request source
   * @returns {object} Permission entry
   */
  function createPermission(agentId, toolName, command, options) {
    var id = 'perm_' + (nextId++) + '_' + Date.now();

    options = options || {};

    var entry = {
      id: id,
      agentId: agentId || '',
      toolName: toolName || '',
      command: command || '',
      cwd: options.cwd || '',
      source: options.source || 'unknown',
      timestamp: Date.now(),
      status: 'pending',  // pending | allowed | denied | always_allowed | timed_out
    };

    // Cap pending permissions to prevent memory leak
    if (pendingPermissions.size >= MAX_PENDING_PERMISSIONS) {
      // Remove the oldest pending entry
      var oldestKey = pendingPermissions.keys().next().value;
      if (oldestKey) {
        var oldest = pendingPermissions.get(oldestKey);
        if (oldest.timer) clearTimeout(oldest.timer);
        pendingPermissions.delete(oldestKey);
      }
    }

    // Auto-timeout
    var timer = setTimeout(function () {
      var pending = pendingPermissions.get(id);
      if (pending) {
        entry.status = 'timed_out';
        pendingPermissions.delete(id);
        log('[Permission] Timed out: ' + id + ' (' + toolName + ' ' + (command || '').slice(0, 80) + ')');
        hideBubble();

        // Notify via callback with denied decision on timeout
        onPermissionResult(id, 'denied', entry);
      }
    }, PERMISSION_TIMEOUT);

    pendingPermissions.set(id, {
      entry: entry,
      timer: timer,
      bubbleWin: null,
    });

    log('[Permission] Created: ' + id + ' (' + toolName + ' ' + (command || '').slice(0, 80) + ')');

    // Show the bubble
    showBubble(entry);

    return entry;
  }

  /**
   * Resolve a pending permission.
   *
   * @param {string} id - Permission ID
   * @param {string} decision - 'allowed', 'denied', or 'always_allowed'
   * @returns {{ success: boolean, entry?: object, error?: string }}
   */
  function resolvePermission(id, decision) {
    var pending = pendingPermissions.get(id);

    if (!pending) {
      return { success: false, error: 'Permission not found or already resolved: ' + id };
    }

    var entry = pending.entry;

    if (entry.status !== 'pending') {
      return { success: false, error: 'Permission already resolved: ' + entry.status };
    }

    // Clear the timeout timer
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    var validDecisions = ['allowed', 'denied', 'always_allowed'];
    if (validDecisions.indexOf(decision) < 0) {
      return { success: false, error: 'Invalid decision: ' + decision };
    }

    entry.status = decision;
    pendingPermissions.delete(id);

    log('[Permission] Resolved: ' + id + ' -> ' + decision);

    // Hide bubble if no more pending permissions
    if (pendingPermissions.size === 0) {
      hideBubble();
    } else {
      // Show the next pending permission
      var nextEntry = pendingPermissions.values().next().value;
      if (nextEntry) {
        showBubble(nextEntry.entry);
      }
    }

    // Notify callback
    onPermissionResult(id, decision, entry);

    return { success: true, entry: entry };
  }

  /**
   * Cancel all pending permissions (e.g., on app shutdown).
   */
  function cancelAll() {
    pendingPermissions.forEach(function (pending, id) {
      if (pending.timer) clearTimeout(pending.timer);
      var entry = pending.entry;
      entry.status = 'cancelled';
      onPermissionResult(id, 'denied', entry);
    });

    pendingPermissions.clear();
    hideBubble();
    log('[Permission] All pending permissions cancelled');
  }

  /**
   * Get a snapshot of all pending permissions.
   *
   * @returns {object[]}
   */
  function listPending() {
    var result = [];
    pendingPermissions.forEach(function (pending) {
      result.push(Object.assign({}, pending.entry));
    });
    return result;
  }

  /**
   * Get a specific pending entry by ID.
   *
   * @param {string} id
   * @returns {object|null}
   */
  function getPending(id) {
    var pending = pendingPermissions.get(id);
    return pending ? Object.assign({}, pending.entry) : null;
  }

  // ── IPC handlers ─────────────────────────────────

  /**
   * Register IPC handlers for permission bubble communication.
   *
   * @param {object} ipcMain - Electron's ipcMain module
   */
  function registerIpc(ipcMain) {
    if (!ipcMain) return;

    // Renderer reports a permission decision
    ipcMain.on('permission:decide', function (event, payload) {
      if (!payload || !payload.id || !payload.decision) {
        log('[Permission] Invalid decide payload: ' + JSON.stringify(payload));
        return;
      }

      var result = resolvePermission(payload.id, payload.decision);
      if (!result.success) {
        log('[Permission] Decide failed: ' + result.error);
      }
    });

    // Renderer reports the bubble's actual content height (for auto-resize)
    ipcMain.on('permission:reportHeight', function (event, height) {
      if (currentBubbleWindow && !currentBubbleWindow.isDestroyed()) {
        var bounds = currentBubbleWindow.getBounds();
        var newHeight = Math.max(BUBBLE_HEIGHT, Math.min(height + 20, 500));
        currentBubbleWindow.setBounds({
          width: BUBBLE_WIDTH,
          height: newHeight,
        });
      }
    });

    // Renderer reports IME editing state (for CJK input)
    ipcMain.on('permission:setImeEditing', function (event, editing) {
      // Could forward IME state for accessibility, currently a no-op
    });
  }

  /**
   * Clean up all resources.
   */
  function destroy() {
    cancelAll();

    if (currentBubbleWindow && !currentBubbleWindow.isDestroyed()) {
      currentBubbleWindow.removeAllListeners();
      currentBubbleWindow.close();
      currentBubbleWindow = null;
    }
  }

  // ── Export API ───────────────────────────────────
  return {
    createPermission: createPermission,
    resolvePermission: resolvePermission,
    cancelAll: cancelAll,
    listPending: listPending,
    getPending: getPending,
    showBubble: showBubble,
    hideBubble: hideBubble,
    repositionBubble: repositionBubble,
    registerIpc: registerIpc,
    destroy: destroy,
  };
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  createPermissionManager,
  BUBBLE_WIDTH: BUBBLE_WIDTH,
  BUBBLE_HEIGHT: BUBBLE_HEIGHT,
  PERMISSION_TIMEOUT: PERMISSION_TIMEOUT,
};
