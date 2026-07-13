/**
 * main/session-hud.js — Session HUD Window Manager
 *
 * Manages a separate transparent BrowserWindow that displays live
 * Claude Code session information: active sessions, states, badges,
 * elapsed times, and context usage.
 *
 * Three visibility states:
 *   hidden   — window is hidden (default)
 *   revealed — shown temporarily, auto-hides after cursor leaves hot zone
 *   pinned   — always visible until explicitly unpinned
 *
 * Exports: { initSessionHud }
 */

'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/**
 * Initialise the Session HUD.
 *
 * @param {object}   ctx
 * @param {function} ctx.getPetWindow  — () => BrowserWindow|null
 * @param {function} ctx.getSnapshot   — () => state snapshot object
 * @param {function} ctx.getI18n       — () => object (i18n key/value map)
 * @param {function} ctx.log           — (string) => void
 * @returns {object}  { reveal, hide, setPinned, broadcastSessionSnapshot, getVisibility, getWindow }
 */
function initSessionHud(ctx) {
  const { getPetWindow, getSnapshot, getI18n, log } = ctx;
  const logger = typeof log === 'function' ? log : (() => {});

  /** @type {BrowserWindow|null} */
  let hudWindow = null;

  /** @type {'hidden'|'revealed'|'pinned'} */
  let visibility = 'hidden';

  /** @type {NodeJS.Timeout|null} */
  let pollTimer = null;

  /** @type {NodeJS.Timeout|null} */
  let hideTimer = null;

  // ─── Helpers ─────────────────────────────────────────────────────────

  function safeLog(msg) {
    logger('[SessionHUD] ' + msg);
  }

  /** Guard against destroyed / missing window. */
  function windowAlive() {
    return hudWindow !== null && !hudWindow.isDestroyed();
  }

  // ─── Window Creation ─────────────────────────────────────────────────

  function createWindow() {
    hudWindow = new BrowserWindow({
      width: 240,
      height: 120,
      transparent: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-session-hud.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Force 'pop-up-menu' level so HUD lives above the pet window
    try {
      hudWindow.setAlwaysOnTop(true, 'pop-up-menu');
    } catch (_) {
      hudWindow.setAlwaysOnTop(true);
    }

    hudWindow.loadFile(path.join(__dirname, '..', 'src', 'session-hud.html'));

    hudWindow.on('closed', () => {
      stopPolling();
      hudWindow = null;
    });
  }

  // ─── Size Computation ────────────────────────────────────────────────

  /**
   * Compute HUD window dimensions based on session count.
   *
   * Layout:
   *   header: 36px
   *   padding: 8px top/bottom
   *   rows: 32px each (show at most 4 before folding)
   *   folded row: 24px
   *
   * Width scales from 190px (0–2 sessions) to 320px (6+).
   *
   * @param {object|null} snapshot
   * @returns {{ width: number, height: number }}
   */
  function computeSize(snapshot) {
    const count = snapshot && Array.isArray(snapshot.orderedIds)
      ? snapshot.orderedIds.length
      : 0;

    const HEADER_H = 36;
    const ROW_H = 32;
    const FOLDED_H = 24;
    const PAD = 8;

    const visible = Math.min(count, 4);
    const folded = count > 4 ? count - 4 : 0;

    let h = HEADER_H + PAD;
    h += visible * ROW_H;
    if (folded > 0) h += FOLDED_H;
    h += PAD;

    h = Math.max(80, Math.min(400, h));

    let w = 190;
    if (count > 2) w = 190 + (count - 2) * 26;
    w = Math.min(320, w);

    return { width: Math.round(w), height: Math.round(h) };
  }

  // ─── Positioning ─────────────────────────────────────────────────────

  /**
   * Position the HUD window relative to the pet window.
   *
   * Strategy:
   *   1. Place centred below the pet window (4px gap).
   *   2. If the HUD overflows the work-area bottom, flip above.
   *   3. If still out of bounds, clamp to work-area bottom.
   *   4. Clamp horizontal to work-area bounds.
   */
  function positionWindow() {
    if (!windowAlive()) return;

    const petWin = typeof getPetWindow === 'function' ? getPetWindow() : null;
    if (!petWin || petWin.isDestroyed()) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const wa = primaryDisplay.workAreaSize;

    const [petX, petY] = petWin.getPosition();
    const [petW, petH] = petWin.getSize();
    const [hudW, hudH] = hudWindow.getSize();

    // Default: centred below pet
    let x = Math.round(petX + (petW - hudW) / 2);
    let y = petY + petH + 4;

    // Flip above if overflow
    if (y + hudH > wa.height) {
      y = petY - hudH - 4;
    }

    // If still out of vertical bounds, pin to bottom
    if (y < 0) {
      y = Math.max(0, wa.height - hudH - 4);
    }

    // Clamp horizontal
    x = Math.max(2, Math.min(x, wa.width - hudW - 2));

    hudWindow.setPosition(x, y);
  }

  // ─── Visibility Management ───────────────────────────────────────────

  /**
   * Reveal the HUD (transition hidden → revealed).
   * No-op when already pinned.
   */
  function reveal() {
    if (!windowAlive()) return;
    if (visibility === 'pinned') return;

    safeLog('Reveal');

    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    applySnapshot(snapshot);
    positionWindow();

    if (!hudWindow.isVisible()) {
      hudWindow.show();
    }

    // Reset opacity in case it was faded
    hudWindow.setOpacity(1.0);

    startPolling();
  }

  /**
   * Hide the HUD (transition revealed → hidden).
   * No-op when pinned.
   */
  function hide() {
    if (visibility === 'pinned') return;
    if (!windowAlive()) return;

    safeLog('Hide');
    visibility = 'hidden';
    stopPolling();
    hudWindow.hide();
  }

  /**
   * Toggle pinned state.
   *
   * @param {boolean} pinned
   */
  function setPinned(pinned) {
    if (!windowAlive()) return;

    if (pinned) {
      safeLog('Pinned');
      visibility = 'pinned';
      if (!hudWindow.isVisible()) {
        const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
        applySnapshot(snapshot);
        positionWindow();
        hudWindow.show();
      }
      hudWindow.setOpacity(1.0);
      stopPolling();

      // Re-assert alwaysOnTop after potential focus-steal
      try {
        hudWindow.setAlwaysOnTop(true, 'pop-up-menu');
      } catch (_) {
        hudWindow.setAlwaysOnTop(true);
      }
    } else {
      safeLog('Unpinned');
      visibility = 'hidden';
      hudWindow.hide();
    }

    // Notify renderer
    if (windowAlive()) {
      hudWindow.webContents.send('session-hud:pinned-changed', pinned);
    }
  }

  // ─── Auto-hide Polling ───────────────────────────────────────────────

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(checkHotZone, 200);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  /**
   * Poll the cursor position and determine whether the HUD should remain visible.
   *
   * Hot zone = bounding box of pet window ∪ HUD window + 24px padding.
   * When the cursor leaves the hot zone a 500ms grace period starts.
   * If the cursor does not re-enter within that time the HUD auto-hides.
   * Repeated leave/reset cycles are debounced via hideTimer.
   */
  function checkHotZone() {
    if (visibility !== 'revealed') return;
    if (!windowAlive()) return;

    const cursor = screen.getCursorScreenPoint();
    // cursor is a Point { x, y } — always valid on modern Electron.

    const petWin = typeof getPetWindow === 'function' ? getPetWindow() : null;
    if (!petWin || petWin.isDestroyed()) {
      hide();
      return;
    }

    const [petX, petY] = petWin.getPosition();
    const [petW, petH] = petWin.getSize();
    const [hudX, hudY] = hudWindow.getPosition();
    const [hudW, hudH] = hudWindow.getSize();

    const PAD = 24;

    const zMinX = Math.min(petX, hudX) - PAD;
    const zMinY = Math.min(petY, hudY) - PAD;
    const zMaxX = Math.max(petX + petW, hudX + hudW) + PAD;
    const zMaxY = Math.max(petY + petH, hudY + hudH) + PAD;

    const inZone = (
      cursor.x >= zMinX && cursor.x <= zMaxX &&
      cursor.y >= zMinY && cursor.y <= zMaxY
    );

    if (inZone) {
      // Reset grace timer if cursor re-entered
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    } else {
      // Cursor left — start or keep grace period
      if (!hideTimer) {
        hideTimer = setTimeout(() => {
          if (visibility === 'revealed' && windowAlive()) {
            safeLog('Auto-hide (cursor left hot zone)');
            hudWindow.hide();
            visibility = 'hidden';
          }
          hideTimer = null;
          stopPolling();
        }, 500);
      }
    }
  }

  // ─── Snapshot Handling ───────────────────────────────────────────────

  /**
   * Update window size from snapshot and send data to the renderer.
   *
   * @param {object|null} snapshot  — the full state snapshot
   */
  function applySnapshot(snapshot) {
    if (!windowAlive()) return;

    const { width, height } = computeSize(snapshot);
    const [curW, curH] = hudWindow.getSize();
    if (width !== curW || height !== curH) {
      hudWindow.setSize(width, height);
      // Re-position after resize
      positionWindow();
    }

    hudWindow.webContents.send('session-hud:session-snapshot', snapshot || {
      sessions: {},
      orderedIds: [],
      groups: {},
    });
  }

  /**
   * Main-process call: broadcast the latest snapshot to the HUD.
   * Called from app code after state changes.
   *
   * @param {object} snapshot
   */
  function broadcastSessionSnapshot(snapshot) {
    if (!windowAlive()) return;
    if (hudWindow.isVisible()) {
      applySnapshot(snapshot);
    }
  }

  // ─── IPC Handlers ────────────────────────────────────────────────────

  function setupIPC() {
    // Renderer requests i18n strings
    ipcMain.handle('session-hud:get-i18n', () => {
      return typeof getI18n === 'function' ? getI18n() : {};
    });

    // Renderer asks main to focus a specific session
    ipcMain.on('session-hud:focus-session', (_event, sessionId) => {
      safeLog('Focus session: ' + sessionId);
      // Extensible: could activate a terminal / VS Code window for this session
    });

    // Renderer asks main to open the Claude Code dashboard
    ipcMain.on('session-hud:open-dashboard', () => {
      safeLog('Open dashboard requested');
      // Extensible: could open a URL or spawn a dashboard window
    });

    // Renderer toggles pinned state
    ipcMain.on('session-hud:set-pinned', (_event, pinned) => {
      setPinned(pinned);
    });

    // Renderer acknowledges a session completion
    ipcMain.handle('session:ack-completion', (_event, sessionId) => {
      safeLog('Ack completion: ' + sessionId);
      // Extensible: the main process could acknowledge and dismiss the session
      return { success: true };
    });
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────

  createWindow();
  setupIPC();

  // ─── Public API ──────────────────────────────────────────────────────

  return {
    reveal,
    hide,
    setPinned,
    broadcastSessionSnapshot,
    getVisibility: () => visibility,
    getWindow: () => hudWindow,
  };
}

module.exports = { initSessionHud };
