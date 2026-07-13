/**
 * main/preload-bubble.js — Permission bubble contextBridge
 *
 * Exposes a safe API for the bubble renderer process to communicate
 * with the main process permission manager.
 *
 * Exposed as `window.bubbleAPI`:
 *   - onPermissionShow(cb)     — Listen for permission-show events
 *   - onPermissionHide(cb)     — Listen for permission-hide events
 *   - decide(id, decision)     — Send a permission decision
 *   - reportHeight(height)     — Report bubble content height for auto-resize
 *   - setImeEditing(editing)   — Report IME editing state
 *
 * @module main/preload-bubble
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  /**
   * Register a callback for when a new permission request is shown.
   *
   * The callback receives a permission entry object:
   *   { id, agentId, toolName, command, cwd, source, timestamp, status }
   *
   * @param {function} cb - Callback(entry)
   * @returns {function} Cleanup function to remove the listener
   */
  onPermissionShow: function (cb) {
    if (typeof cb !== 'function') {
      throw new TypeError('onPermissionShow requires a function callback');
    }

    var handler = function (_event, entry) {
      cb(entry);
    };

    ipcRenderer.on('permission-show', handler);

    // Return cleanup function
    return function () {
      ipcRenderer.removeListener('permission-show', handler);
    };
  },

  /**
   * Register a callback for when the permission bubble is hidden.
   *
   * @param {function} cb - Callback()
   * @returns {function} Cleanup function to remove the listener
   */
  onPermissionHide: function (cb) {
    if (typeof cb !== 'function') {
      throw new TypeError('onPermissionHide requires a function callback');
    }

    var handler = function () {
      cb();
    };

    ipcRenderer.on('permission-hide', handler);

    return function () {
      ipcRenderer.removeListener('permission-hide', handler);
    };
  },

  /**
   * Send a permission decision back to the main process.
   *
   * @param {string} id - Permission request ID
   * @param {string} decision - 'allowed', 'denied', or 'always_allowed'
   */
  decide: function (id, decision) {
    if (!id || typeof id !== 'string') {
      console.warn('[BubblePreload] Invalid permission ID:', id);
      return;
    }

    var validDecisions = ['allowed', 'denied', 'always_allowed'];
    if (validDecisions.indexOf(decision) < 0) {
      console.warn('[BubblePreload] Invalid decision:', decision);
      return;
    }

    ipcRenderer.send('permission:decide', {
      id: id,
      decision: decision,
    });
  },

  /**
   * Report the bubble's actual content height to the main process
   * so the window can be auto-resized.
   *
   * @param {number} height - Content height in pixels
   */
  reportHeight: function (height) {
    if (typeof height !== 'number' || !Number.isFinite(height)) {
      return;
    }
    ipcRenderer.send('permission:reportHeight', Math.max(100, Math.min(height, 800)));
  },

  /**
   * Report whether the user is currently editing with an IME (CJK input).
   *
   * The main process can use this to suppress keyboard shortcuts while
   * the user is composing text.
   *
   * @param {boolean} editing - Whether IME is active
   */
  setImeEditing: function (editing) {
    ipcRenderer.send('permission:setImeEditing', !!editing);
  },
});
