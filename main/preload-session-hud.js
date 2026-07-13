/**
 * main/preload-session-hud.js — Session HUD Preload
 *
 * Exposes sessionHudAPI via contextBridge for the HUD renderer.
 *
 * API surface:
 *   getI18n()           — invoke  → session-hud:get-i18n
 *   focusSession(id)    — send     → session-hud:focus-session
 *   openDashboard()     — send     → session-hud:open-dashboard
 *   setPinned(bool)     — send     → session-hud:set-pinned
 *   ackCompletion(id)   — invoke  → session:ack-completion
 *   onSessionSnapshot   — subscribe to session-hud:session-snapshot
 *   onLangChange        — subscribe to session-hud:lang-change
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sessionHudAPI', {
  // ── Invoke (request / response) ───────────────────────────────────

  /** @returns {Promise<object>} */
  getI18n: () => ipcRenderer.invoke('session-hud:get-i18n'),

  /**
   * Acknowledge a session completion.
   * @param {string} sessionId
   * @returns {Promise<{success: boolean}>}
   */
  ackCompletion: (sessionId) => ipcRenderer.invoke('session:ack-completion', sessionId),

  // ── Send (fire-and-forget) ────────────────────────────────────────

  /**
   * Request main process to focus / activate a session.
   * @param {string} sessionId
   */
  focusSession: (sessionId) => ipcRenderer.send('session-hud:focus-session', sessionId),

  /** Request main process to open the Claude Code dashboard. */
  openDashboard: () => ipcRenderer.send('session-hud:open-dashboard'),

  /**
   * Toggle HUD pinned state.
   * @param {boolean} pinned
   */
  setPinned: (pinned) => ipcRenderer.send('session-hud:set-pinned', pinned),

  // ── Listen (push from main) ───────────────────────────────────────

  /**
   * Subscribe to session snapshot updates.
   * @param {(snapshot: object) => void} cb
   * @returns {() => void} unsubscribe function
   */
  onSessionSnapshot: (cb) => {
    const handler = (_event, snapshot) => cb(snapshot);
    ipcRenderer.on('session-hud:session-snapshot', handler);
    return () => ipcRenderer.removeListener('session-hud:session-snapshot', handler);
  },

  /**
   * Subscribe to language-change notifications.
   * @param {(lang: string) => void} cb
   * @returns {() => void} unsubscribe function
   */
  onLangChange: (cb) => {
    const handler = (_event, lang) => cb(lang);
    ipcRenderer.on('session-hud:lang-change', handler);
    return () => ipcRenderer.removeListener('session-hud:lang-change', handler);
  },
});
