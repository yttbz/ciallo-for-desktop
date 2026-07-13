/**
 * main/hook-install.js — Claude Code Hook Installer
 *
 * Installs ciallo-hook.js into ~/.claude/settings.json so Claude Code
 * sends events to the CialloForDesktop hook server.
 *
 * Ported from clawd-on-desk's hooks/install.js (simplified).
 *
 * @module main/hook-install
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Constants ───────────────────────────────────────────────────────────────

const CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, 'settings.json');

/**
 * Core hook events we register for.
 */
const CORE_HOOKS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'Notification',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read and parse JSON from a file, returning null on failure.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonFile(filePath) {
  try {
    var raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Atomically write a JSON object to a file.
 * @param {string} filePath
 * @param {object} data
 * @returns {boolean}
 */
function writeJsonAtomic(filePath, data) {
  var dir = path.dirname(filePath);
  var tmpPath = path.join(dir, '.tmp.' + process.pid + '.' + Date.now() + '.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (e2) {}
    return false;
  }
}

/**
 * Resolve the path to the hook script.
 * When packaged, the hook script is in the app's resources.
 * When running from source, it's in the hooks/ directory next to main/.
 *
 * @param {object} app - Electron app (optional, for app.getAppPath())
 * @returns {string} Absolute path to ciallo-hook.js
 */
function resolveHookScriptPath(app) {
  // In development / from source
  var devPath = path.join(__dirname, '..', 'hooks', 'ciallo-hook.js');
  if (fs.existsSync(devPath)) return devPath;

  // Packaged: look in resources
  try {
    if (app && typeof app.getAppPath === 'function') {
      var pkgPath = path.join(app.getAppPath(), 'hooks', 'ciallo-hook.js');
      if (fs.existsSync(pkgPath)) return pkgPath;
    }
  } catch (e) {}

  // Fallback: try process.cwd()
  var cwdPath = path.join(process.cwd(), 'hooks', 'ciallo-hook.js');
  if (fs.existsSync(cwdPath)) return cwdPath;

  return devPath; // return the dev path as best guess
}

/**
 * Build hook command string for Claude Code settings.json.
 *
 * @param {string} hookScriptPath - Absolute path to ciallo-hook.js
 * @param {object} [app] - Electron app instance
 * @returns {string} Command string like "node /path/to/ciallo-hook.js {event}"
 */
function buildHookCommand(hookScriptPath) {
  // Use the system node binary
  var nodeBin = process.execPath;
  // On Electron, process.execPath is the Electron binary, not node.
  // Try to find a real node binary.
  if (process.versions && process.versions.electron) {
    // Don't use Electron's bundled node - find system node
    var candidates = [
      '/usr/bin/node',
      '/usr/local/bin/node',
      '/opt/homebrew/bin/node',
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        fs.accessSync(candidates[i], fs.constants.X_OK);
        nodeBin = candidates[i];
        break;
      } catch (e) {}
    }
  }

  // On Windows, if we haven't found a better node, keep process.execPath
  if (process.platform === 'win32' && process.versions && process.versions.electron) {
    var winCandidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Default', 'Programs', 'nodejs', 'node.exe'),
    ];
    for (var j = 0; j < winCandidates.length; j++) {
      try {
        fs.accessSync(winCandidates[j], fs.constants.X_OK);
        nodeBin = winCandidates[j];
        break;
      } catch (e) {}
    }
  }

  return nodeBin + ' "' + hookScriptPath + '" {event}';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Install ciallo hooks into Claude Code settings.json.
 *
 * Merges hook commands into the existing settings without removing existing hooks.
 *
 * @param {object} [options]
 * @param {boolean} [options.silent] - Suppress console output
 * @param {number} [options.port] - Server port hint
 * @param {object} [options.app] - Electron app instance
 * @returns {{ success: boolean, installed: number, message: string }}
 */
function installHooks(options) {
  options = options || {};
  var silent = !!options.silent;
  var app = options.app || null;
  var hookScriptPath = resolveHookScriptPath(app);
  var hookCommand = buildHookCommand(hookScriptPath);

  // Read existing settings
  var settings = readJsonFile(CLAUDE_SETTINGS_PATH) || {};

  // Ensure the hooks object exists
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }

  var installed = 0;

  for (var i = 0; i < CORE_HOOKS.length; i++) {
    var eventName = CORE_HOOKS[i];

    // Default to empty array
    if (!Array.isArray(settings.hooks[eventName])) {
      settings.hooks[eventName] = [];
    }

    // Check if our hook is already installed
    var alreadyExists = false;
    for (var j = 0; j < settings.hooks[eventName].length; j++) {
      var existing = settings.hooks[eventName][j];
      if (typeof existing === 'string' && existing.includes('ciallo-hook.js')) {
        alreadyExists = true;
        // Update the command in case path changed
        settings.hooks[eventName][j] = hookCommand;
        break;
      }
    }

    if (!alreadyExists) {
      settings.hooks[eventName].push(hookCommand);
      installed++;
    }
  }

  // Write back
  if (!writeJsonAtomic(CLAUDE_SETTINGS_PATH, settings)) {
    return { success: false, installed: installed, message: 'Failed to write settings.json' };
  }

  if (!silent) {
    console.log('[HookInstall] Installed ' + installed + ' new hook(s) into ' + CLAUDE_SETTINGS_PATH);
    console.log('[HookInstall] Command: ' + hookCommand);
  }

  return { success: true, installed: installed, message: 'Hooks installed successfully' };
}

/**
 * Uninstall ciallo hooks from Claude Code settings.json.
 *
 * Removes all hook commands that reference ciallo-hook.js.
 *
 * @param {object} [options]
 * @param {boolean} [options.silent] - Suppress console output
 * @returns {{ success: boolean, removed: number, message: string }}
 */
function uninstallHooks(options) {
  options = options || {};
  var silent = !!options.silent;

  var settings = readJsonFile(CLAUDE_SETTINGS_PATH);
  if (!settings || !settings.hooks) {
    return { success: true, removed: 0, message: 'No hooks to remove' };
  }

  var removed = 0;

  for (var eventName in settings.hooks) {
    if (!Object.prototype.hasOwnProperty.call(settings.hooks, eventName)) continue;
    if (!Array.isArray(settings.hooks[eventName])) continue;

    var filtered = [];
    for (var i = 0; i < settings.hooks[eventName].length; i++) {
      var hook = settings.hooks[eventName][i];
      if (typeof hook === 'string' && hook.includes('ciallo-hook.js')) {
        removed++;
      } else {
        filtered.push(hook);
      }
    }
    settings.hooks[eventName] = filtered;
  }

  if (!writeJsonAtomic(CLAUDE_SETTINGS_PATH, settings)) {
    return { success: false, removed: removed, message: 'Failed to write settings.json' };
  }

  if (!silent) {
    console.log('[HookInstall] Removed ' + removed + ' hook(s) from ' + CLAUDE_SETTINGS_PATH);
  }

  return { success: true, removed: removed, message: 'Hooks uninstalled successfully' };
}

/**
 * Check whether ciallo hooks are currently installed.
 *
 * @returns {{ installed: boolean, count: number }}
 */
function checkHooksInstalled() {
  var settings = readJsonFile(CLAUDE_SETTINGS_PATH);
  if (!settings || !settings.hooks) {
    return { installed: false, count: 0 };
  }

  var count = 0;
  for (var eventName in settings.hooks) {
    if (!Object.prototype.hasOwnProperty.call(settings.hooks, eventName)) continue;
    if (!Array.isArray(settings.hooks[eventName])) continue;
    for (var i = 0; i < settings.hooks[eventName].length; i++) {
      if (typeof settings.hooks[eventName][i] === 'string' && settings.hooks[eventName][i].includes('ciallo-hook.js')) {
        count++;
      }
    }
  }

  return { installed: count > 0, count: count };
}

function getHookEvents() {
  return CORE_HOOKS.slice();
}

module.exports = {
  installHooks,
  uninstallHooks,
  checkHooksInstalled,
  getHookEvents,
  resolveHookScriptPath,
  buildHookCommand,
  CLAUDE_SETTINGS_PATH,
};
