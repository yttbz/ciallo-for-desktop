/**
 * CialloForDesktop - Settings Controller
 *
 * Orchestrates the settings lifecycle: validation -> store commit -> disk persist.
 * Provides a locking layer to prevent race conditions on sequential writes,
 * and higher-level commands for multi-field operations.
 *
 * Ported from the clawd pattern:
 *   createSettingsController({prefsPath, store}) -> { applyUpdate, applyCommand, getSnapshot, subscribe }
 *
 * Dependencies:
 *   - ./settings.js  (validate, getDefaults)
 *   - ./settings-store.js  (createStore)
 */

const fs = require('fs');
const path = require('path');
const settings = require('./settings');

/**
 * Create a settings controller that binds validation, a reactive store,
 * and file persistence together.
 *
 * @param {Object} options
 * @param {string} options.prefsPath - Absolute path to the settings JSON file
 * @param {Object} options.store - A store created by createStore() — must expose { getSnapshot, subscribe, _commit }
 * @returns {{ applyUpdate, applyCommand, getSnapshot, subscribe }}
 */
function createSettingsController({ prefsPath, store }) {
  if (!prefsPath || typeof prefsPath !== 'string') {
    throw new TypeError('[SettingsController] prefsPath must be a non-empty string');
  }
  if (!store || typeof store._commit !== 'function') {
    throw new TypeError('[SettingsController] store must be a valid store with _commit()');
  }

  // ---- Async lock ----
  // Chains promises so only one write operation runs at a time.
  // This prevents races when multiple updates arrive in quick succession
  // (e.g., batch UI toggles or rapid IPC calls).
  let lockChain = Promise.resolve();

  /**
   * Wrap an async operation in the exclusive lock.
   * Ensures sequential execution of all write operations.
   *
   * @param {Function} fn - Async function to run under lock
   * @returns {Promise<any>}
   */
  function withLock(fn) {
    return new Promise((resolve, reject) => {
      lockChain = lockChain.then(() => fn().then(resolve, reject));
    });
  }

  // ---- Persistence ----

  /**
   * Persist the current store snapshot to disk.
   * Creates parent directories if needed.
   * Validates before writing to ensure data integrity.
   *
   * @param {Object} snapshot - The settings object to persist
   * @returns {{ success: boolean, error?: string }}
   */
  function persist(snapshot) {
    try {
      const validated = settings.validate(snapshot);
      const dir = path.dirname(prefsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(prefsPath, JSON.stringify(validated, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      console.error('[SettingsController] Persist error:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ---- Public API ----

  /**
   * Get the current settings snapshot from the store.
   *
   * @returns {Object}
   */
  function getSnapshot() {
    return store.getSnapshot();
  }

  /**
   * Subscribe to settings changes.
   *
   * @param {Function} listener - Callback(newSnapshot) called on every successful change
   * @returns {Function} unsubscribe function
   */
  function subscribe(listener) {
    return store.subscribe(listener);
  }

  /**
   * Update a single setting key.
   *
   * Flow:
   *   1. Merge new value into current snapshot
   *   2. Validate the full snapshot (clamps out-of-range values)
   *   3. Commit to store (notifies subscribers on actual change)
   *   4. Persist to disk
   *
   * Async-locked to prevent race conditions on sequential rapid writes.
   *
   * @param {string} key - Setting key (e.g., 'modelScale', 'alwaysOnTop')
   * @param {*} value - New value for the setting
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  function applyUpdate(key, value) {
    return withLock(async () => {
      const current = store.getSnapshot();
      const merged = { ...current, [key]: value };
      const validated = settings.validate(merged);

      // Commit to store (triggers subscriber notification)
      const committed = store._commit(validated);

      if (!committed) {
        // Value didn't actually change — still persist to be safe
        // (file might have been corrupted externally)
      }

      // Persist to disk
      const result = persist(validated);

      if (!result.success && committed) {
        // Store was updated but write failed — roll back
        store._commit(current);
        console.warn('[SettingsController] Rolled back store update after persist failure');
      }

      return result;
    });
  }

  /**
   * Execute a multi-field settings command.
   *
   * Supported actions:
   *   - 'reset'               -> Restore all settings to defaults
   *   - 'batchUpdate'         -> Apply multiple key-value pairs at once (payload: { key: value, ... })
   *   - 'addSshProfile'       -> Add an SSH connection profile (payload: profile object)
   *   - 'removeSshProfile'    -> Remove an SSH profile by id (payload: profileId string)
   *   - 'updateSshProfile'    -> Update an existing SSH profile (payload: profile object with id)
   *   - 'setLanguage'         -> Set the language/locale (payload: locale string)
   *
   * Async-locked to prevent race conditions.
   *
   * @param {string} action - Command action name
   * @param {*} payload - Action-specific payload
   * @returns {Promise<{ success: boolean, error?: string, snapshot?: Object }>}
   */
  function applyCommand(action, payload) {
    return withLock(async () => {
      const current = store.getSnapshot();

      let updated;

      switch (action) {
        case 'reset': {
          updated = settings.getDefaults();
          break;
        }

        case 'batchUpdate': {
          if (!payload || typeof payload !== 'object') {
            return { success: false, error: 'batchUpdate payload must be an object' };
          }
          updated = { ...current, ...payload };
          break;
        }

        case 'addSshProfile': {
          if (!payload || !payload.id || !payload.host) {
            return { success: false, error: 'SSH profile requires at least id and host' };
          }
          const profiles = Array.isArray(current.sshProfiles) ? [...current.sshProfiles] : [];
          // Prevent duplicates
          if (profiles.some(p => p.id === payload.id)) {
            return { success: false, error: `SSH profile with id '${payload.id}' already exists` };
          }
          profiles.push({
            id: payload.id,
            name: payload.name || payload.host,
            host: payload.host,
            port: typeof payload.port === 'number' ? payload.port : 22,
            user: payload.user || 'root',
            keyPath: payload.keyPath || '',
            autoReconnect: !!payload.autoReconnect,
          });
          updated = { ...current, sshProfiles: profiles };
          break;
        }

        case 'removeSshProfile': {
          if (!payload || typeof payload !== 'string') {
            return { success: false, error: 'removeSshProfile payload must be a profile id string' };
          }
          const existing = Array.isArray(current.sshProfiles) ? current.sshProfiles : [];
          updated = { ...current, sshProfiles: existing.filter(p => p.id !== payload) };
          break;
        }

        case 'updateSshProfile': {
          if (!payload || !payload.id) {
            return { success: false, error: 'updateSshProfile payload requires at least id' };
          }
          const profiles = Array.isArray(current.sshProfiles) ? [...current.sshProfiles] : [];
          const idx = profiles.findIndex(p => p.id === payload.id);
          if (idx === -1) {
            return { success: false, error: `SSH profile with id '${payload.id}' not found` };
          }
          profiles[idx] = {
            ...profiles[idx],
            ...payload,
            // Ensure id and host are never overwritten with invalid values
            id: payload.id,
            host: payload.host || profiles[idx].host,
            port: typeof payload.port === 'number' ? payload.port : profiles[idx].port,
          };
          updated = { ...current, sshProfiles: profiles };
          break;
        }

        case 'setLanguage': {
          if (!payload || typeof payload !== 'string') {
            return { success: false, error: 'setLanguage payload must be a locale string' };
          }
          updated = { ...current, language: payload };
          break;
        }

        default:
          return { success: false, error: `Unknown action: '${action}'` };
      }

      // Validate the full snapshot
      const validated = settings.validate(updated);

      // Commit to store
      const previousSnapshot = store.getSnapshot();
      const committed = store._commit(validated);

      // Persist to disk
      const result = persist(validated);

      if (!result.success && committed) {
        // Write failed but store was updated — roll back
        store._commit(previousSnapshot);
        console.warn('[SettingsController] Rolled back store update after persist failure');
      }

      return {
        ...result,
        snapshot: committed ? validated : previousSnapshot,
      };
    });
  }

  return {
    applyUpdate,
    applyCommand,
    getSnapshot,
    subscribe,
  };
}

module.exports = { createSettingsController };
