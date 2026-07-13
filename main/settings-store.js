/**
 * CialloForDesktop - Reactive Settings Store
 *
 * Lightweight in-memory reactive store with shallow-equality diffing
 * to prevent death-spiral notification loops.
 *
 * Ported from the clawd pattern:
 *   createStore(initialSnapshot) -> { getSnapshot, subscribe, _commit }
 *
 * - _commit does per-key Object.is comparison, only publishes on actual change
 * - subscribe returns an unsubscribe function
 * - Subscriber errors are isolated via try/catch
 */

/**
 * Create a reactive store with an immutable snapshot pattern.
 *
 * @param {Object} initialSnapshot - The initial state object
 * @returns {{ getSnapshot: function, subscribe: function, _commit: function }}
 *
 * @example
 * const store = createStore({ count: 0, name: 'foo' });
 * const unsub = store.subscribe((snap) => console.log('changed', snap));
 * store._commit({ count: 1 });   // triggers notification
 * store._commit({ count: 1 });   // NO-OP: same value, no notification
 * unsub();
 */
function createStore(initialSnapshot) {
  if (!initialSnapshot || typeof initialSnapshot !== 'object') {
    throw new TypeError('[Store] initialSnapshot must be a non-null object');
  }

  // Deep-clone initial snapshot to avoid external mutation
  let snapshot = { ...initialSnapshot };

  /** @type {Set<Function>} */
  let listeners = new Set();

  let version = 0;

  /**
   * Return the current immutable snapshot.
   * Consumers should treat the returned object as read-only.
   *
   * @returns {Object}
   */
  function getSnapshot() {
    return snapshot;
  }

  /**
   * Subscribe to state changes.
   * The callback is invoked with the new snapshot on every _commit
   * that actually changes at least one key.
   *
   * @param {Function} listener - Callback(snapshot) called on change
   * @returns {Function} unsubscribe function
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('[Store] subscriber must be a function');
    }

    listeners.add(listener);

    // Return unsubscribe function
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  /**
   * Commit a partial state update.
   *
   * Performs shallow equality diff per key using Object.is.
   * Only notifies subscribers if at least one key actually changed value.
   * This prevents death-spiral loops where a subscriber's write-back
   * triggers another notification.
   *
   * All subscribers are wrapped in try/catch so that one faulty
   * subscriber cannot break the rest.
   *
   * @param {Object} partial - Key-value pairs to update
   * @returns {boolean} true if the snapshot was modified
   *
   * @note This is intentionally prefixed with _ to signal it's an
   *       internal method not meant for public use outside of the
   *       settings controller layer.
   */
  function _commit(partial) {
    if (!partial || typeof partial !== 'object') {
      console.warn('[Store] _commit called with invalid partial, ignoring');
      return false;
    }

    const keys = Object.keys(partial);
    if (keys.length === 0) return false;

    // Shallow equality diff: check if any key actually changed
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!Object.is(snapshot[key], partial[key])) {
        changed = true;
        break;
      }
    }

    if (!changed) {
      return false;
    }

    // Create new snapshot (immutable update)
    snapshot = { ...snapshot, ...partial };
    version++;

    // Notify all subscribers with error isolation
    const currentSnapshot = snapshot;
    const currentListeners = [...listeners];

    for (let i = 0; i < currentListeners.length; i++) {
      try {
        currentListeners[i](currentSnapshot);
      } catch (err) {
        console.error('[Store] Subscriber error:', err);
      }
    }

    return true;
  }

  return {
    getSnapshot,
    subscribe,
    _commit,
    // Expose version for debugging/testing
    _version: () => version,
  };
}

module.exports = { createStore };
