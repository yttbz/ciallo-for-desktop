/**
 * main/remote-ssh-ipc.js — IPC bridge for SSH remote system
 *
 * Registers Electron IPC handlers that connect the renderer process
 * to the SSH runtime state machine.
 *
 * Channels:
 *   remoteSsh:listStatuses   — Get status of all profiles
 *   remoteSsh:connect        — Connect a profile
 *   remoteSsh:disconnect     — Disconnect a profile
 *   remoteSsh:deploy         - Deploy hook config to remote
 *   remoteSsh:openTerminal   — Open terminal to remote host
 *   remoteSsh:statusChanged  — Broadcast (main -> renderer)
 *
 * @module main/remote-ssh-ipc
 */

'use strict';

const { BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

// ─── IPC Registration ─────────────────────────────────────────────────────────

/**
 * Register all SSH remote IPC handlers on the given ipcMain instance.
 *
 * @param {object} ipcMain - Electron's ipcMain module
 * @param {object} runtime - SSH runtime instance (from createRemoteSshRuntime)
 * @param {object} [ctx] - Additional context
 * @param {function} [ctx.getProfiles] - Function returning current profile array
 */
function registerRemoteSshIpc(ipcMain, runtime, ctx) {
  if (!ipcMain || !runtime) {
    throw new TypeError('registerRemoteSshIpc requires ipcMain and runtime');
  }

  ctx = ctx || {};
  var getProfiles = (typeof ctx.getProfiles === 'function')
    ? ctx.getProfiles
    : function () { return []; };

  // ── Utility: get all windows to broadcast ────────

  /**
   * Send an event to all renderer windows.
   *
   * @param {string} channel
   * @param {*} data
   */
  function broadcastToWindows(channel, data) {
    BrowserWindow.getAllWindows().forEach(function (win) {
      if (win && !win.isDestroyed()) {
        try {
          win.webContents.send(channel, data);
        } catch (_) {
          // Window may have been destroyed mid-iteration
        }
      }
    });
  }

  // ── Forward runtime status changes to all windows ─

  var emitter = runtime.getEmitter();

  emitter.on('status-changed', function (profileId, status) {
    broadcastToWindows('remoteSsh:statusChanged', status);
  });

  // ── Handler: listStatuses ────────────────────────

  /**
   * Returns the status of all known profiles (from runtime + config).
   *
   * Handler for: ipcMain.handle('remoteSsh:listStatuses')
   */
  ipcMain.handle('remoteSsh:listStatuses', function () {
    var profiles = getProfiles();
    var profileIds = profiles.map(function (p) { return p.id; });
    return runtime.listStatusesFor(profileIds);
  });

  // ── Handler: connect ─────────────────────────────

  /**
   * Connect a remote SSH tunnel for the given profile.
   *
   * Handler for: ipcMain.handle('remoteSsh:connect')
   *
   * @param {Electron.IpcMainInvokeEvent} event
   * @param {string} profileId
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('remoteSsh:connect', function (event, profileId) {
    if (!profileId || typeof profileId !== 'string') {
      return { success: false, error: 'Invalid profile ID' };
    }

    var profiles = getProfiles();
    var profile = profiles.find(function (p) { return p.id === profileId; });

    if (!profile) {
      return { success: false, error: 'Profile not found: ' + profileId };
    }

    var ok = runtime.connect(profile);
    return ok
      ? { success: true }
      : { success: false, error: 'Failed to initiate connection (already connected or invalid profile)' };
  });

  // ── Handler: disconnect ──────────────────────────

  /**
   * Disconnect a remote SSH tunnel.
   *
   * Handler for: ipcMain.handle('remoteSsh:disconnect')
   *
   * @param {Electron.IpcMainInvokeEvent} event
   * @param {string} profileId
   * @returns {{ success: boolean }}
   */
  ipcMain.handle('remoteSsh:disconnect', function (event, profileId) {
    if (!profileId || typeof profileId !== 'string') {
      return { success: false, error: 'Invalid profile ID' };
    }

    runtime.disconnect(profileId);
    return { success: true };
  });

  // ── Handler: deploy ──────────────────────────────

  /**
   * Deploy Claude Code hook configuration to the remote server.
   *
   * Copies the ciallo runtime info to the remote and sets up the
   * Claude Code hook to forward events back through the SSH tunnel.
   *
   * Handler for: ipcMain.handle('remoteSsh:deploy')
   *
   * @param {Electron.IpcMainInvokeEvent} event
   * @param {string} profileId
   * @returns {Promise<{ success: boolean, output?: string, error?: string }>}
   */
  ipcMain.handle('remoteSsh:deploy', function (event, profileId) {
    return new Promise(function (resolve) {
      if (!profileId || typeof profileId !== 'string') {
        resolve({ success: false, error: 'Invalid profile ID' });
        return;
      }

      var profiles = getProfiles();
      var profile = profiles.find(function (p) { return p.id === profileId; });

      if (!profile) {
        resolve({ success: false, error: 'Profile not found: ' + profileId });
        return;
      }

      // Check connection status
      var status = runtime.getStatus(profileId);
      if (!status || status.state !== 'connected') {
        resolve({ success: false, error: 'SSH tunnel is not connected' });
        return;
      }

      var remotePort = profile.remoteForwardPort || 23333;
      var hostPrefix = profile.hostPrefix || 'remote';

      // Build the deploy command
      var sshArgs = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-p', String(profile.port || 22),
      ];

      if (profile.identityFile) {
        sshArgs.push('-i', profile.identityFile);
      }

      // Deploy hook config via SSH heredoc
      var deployCommand = [
        'mkdir -p ~/.claude &&',
        'cat > ~/.claude/hooks.json << \'EOF\'',
        '{',
        '  "pre-tool-use": {',
        '    "url": "http://127.0.0.1:' + remotePort + '/state"',
        '    "method": "POST",',
        '    "headers": { "Content-Type": "application/json" }',
        '  },',
        '  "post-tool-use": {',
        '    "url": "http://127.0.0.1:' + remotePort + '/state",',
        '    "method": "POST",',
        '    "headers": { "Content-Type": "application/json" }',
        '  }',
        '}',
        'EOF',
        'echo "Deploy complete: hooks.json written to ~/.claude/"',
      ].join('\n');

      sshArgs.push(profile.host, '--');
      sshArgs.push(deployCommand);

      try {
        var child = spawn('ssh', sshArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15000,
        });

        var stdout = '';
        var stderr = '';

        child.stdout.on('data', function (data) {
          stdout += data.toString('utf-8');
        });

        child.stderr.on('data', function (data) {
          stderr += data.toString('utf-8');
        });

        child.on('error', function (err) {
          resolve({ success: false, error: 'Failed to spawn deploy SSH: ' + err.message });
        });

        child.on('exit', function (code) {
          if (code === 0) {
            resolve({
              success: true,
              output: stdout.trim(),
            });
          } else {
            resolve({
              success: false,
              error: 'Deploy failed (exit ' + code + '): ' + (stderr.trim() || stdout.trim()).slice(0, 500),
            });
          }
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  });

  // ── Handler: openTerminal ────────────────────────

  /**
   * Open a terminal emulator connected to the remote host.
   *
   * Platform-specific behavior:
   *   - Windows: spawns 'start ssh <host>'
   *   - macOS: spawns 'open -a Terminal ssh <host>'
   *   - Linux: spawns 'x-terminal-emulator -e ssh <host>'
   *
   * Handler for: ipcMain.handle('remoteSsh:openTerminal')
   *
   * @param {Electron.IpcMainInvokeEvent} event
   * @param {string} profileId
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('remoteSsh:openTerminal', function (event, profileId) {
    if (!profileId || typeof profileId !== 'string') {
      return { success: false, error: 'Invalid profile ID' };
    }

    var profiles = getProfiles();
    var profile = profiles.find(function (p) { return p.id === profileId; });

    if (!profile) {
      return { success: false, error: 'Profile not found: ' + profileId };
    }

    var sshCmd = 'ssh';
    var sshArgs = [];

    var port = profile.port;
    if (typeof port === 'number' && port !== 22) {
      sshArgs.push('-p', String(port));
    }

    if (profile.identityFile) {
      sshArgs.push('-i', profile.identityFile);
    }

    sshArgs.push(profile.host);

    try {
      var platform = process.platform;

      if (platform === 'win32') {
        // Windows: use start to open a new terminal window
        var cmd = 'start "SSH ' + profile.host + '" ' + sshCmd + ' ' + sshArgs.join(' ');
        spawn('cmd.exe', ['/c', cmd], {
          detached: true,
          stdio: 'ignore',
        });
      } else if (platform === 'darwin') {
        // macOS: open Terminal.app
        var macCmd = 'tell application "Terminal" to do script "' +
                      sshCmd + ' ' + sshArgs.join(' ') + '"';
        spawn('osascript', ['-e', macCmd], {
          detached: true,
          stdio: 'ignore',
        });
      } else {
        // Linux: try x-terminal-emulator, then xterm, then gnome-terminal
        var terminalEmulators = [
          ['x-terminal-emulator', '-e', sshCmd].concat(sshArgs),
          ['xterm', '-e', sshCmd].concat(sshArgs),
          ['gnome-terminal', '--', sshCmd].concat(sshArgs),
          ['konsole', '-e', sshCmd].concat(sshArgs),
          ['lxterminal', '-e', sshCmd].concat(sshArgs),
        ];

        // Try each terminal emulator
        var launched = false;
        for (var i = 0; i < terminalEmulators.length && !launched; i++) {
          var termCmd = terminalEmulators[i];
          try {
            var termChild = spawn(termCmd[0], termCmd.slice(1), {
              detached: true,
              stdio: 'ignore',
            });
            termChild.on('error', function () {
              // Silently try next
            });
            termChild.unref();
            launched = true;
          } catch (_) {
            // Try next
          }
        }

        if (!launched) {
          // Last resort: just spawn ssh in a new process group
          spawn(sshCmd, sshArgs, {
            detached: true,
            stdio: 'ignore',
          });
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Handler: startCodexMonitor ───────────────────

  /**
   * Start the remote Claude Code monitor on the remote host.
   *
   * Handler for: ipcMain.handle('remoteSsh:startCodexMonitor')
   */
  ipcMain.handle('remoteSsh:startCodexMonitor', function (event, profileId) {
    return new Promise(function (resolve) {
      if (!profileId || typeof profileId !== 'string') {
        resolve({ success: false, error: 'Invalid profile ID' });
        return;
      }

      var profiles = getProfiles();
      var profile = profiles.find(function (p) { return p.id === profileId; });

      if (!profile) {
        resolve({ success: false, error: 'Profile not found' });
        return;
      }

      var status = runtime.getStatus(profileId);
      if (!status || status.state !== 'connected') {
        resolve({ success: false, error: 'Not connected' });
        return;
      }

      var remotePort = profile.remoteForwardPort || 23333;

      var monitorArgs = [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-p', String(profile.port || 22),
      ];

      if (profile.identityFile) {
        monitorArgs.push('-i', profile.identityFile);
      }

      // Remote command: start a simple polling loop that sends Claude Code
      // process status through the reverse tunnel
      var remoteCmd = [
        'nohup',
        'bash -c \'',
        'while true; do',
        '  if pgrep -f "claude" > /dev/null 2>&1; then',
        '    curl -s -X POST http://127.0.0.1:' + remotePort + '/state',
        '      -H "Content-Type: application/json"',
        '      -d \'{"type":"Notification","data":{"source":"codex-monitor","status":"running"}}\'',
        '    > /dev/null 2>&1;',
        '  fi;',
        '  sleep 5;',
        'done &',
        'echo "Codex monitor started"\'',
      ].join(' ');

      monitorArgs.push(profile.host, '--');
      monitorArgs.push(remoteCmd);

      try {
        var monChild = spawn('ssh', monitorArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
        });

        var monStdout = '';
        var monStderr = '';

        monChild.stdout.on('data', function (data) {
          monStdout += data.toString('utf-8');
        });
        monChild.stderr.on('data', function (data) {
          monStderr += data.toString('utf-8');
        });

        monChild.on('error', function (err) {
          resolve({ success: false, error: err.message });
        });

        monChild.on('exit', function (code) {
          if (code === 0) {
            resolve({ success: true, output: monStdout.trim() });
          } else {
            resolve({
              success: false,
              error: 'Monitor start failed: ' + (monStderr.trim() || monStdout.trim()).slice(0, 300),
            });
          }
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  });

  // ── Return cleanup function ──────────────────────

  /**
   * Remove all registered IPC handlers.
   * Call this during app shutdown.
   */
  function unregisterAll() {
    var channels = [
      'remoteSsh:listStatuses',
      'remoteSsh:connect',
      'remoteSsh:disconnect',
      'remoteSsh:deploy',
      'remoteSsh:openTerminal',
      'remoteSsh:startCodexMonitor',
    ];

    channels.forEach(function (channel) {
      try {
        ipcMain.removeHandler(channel);
      } catch (_) {
        // Handler may not exist
      }
    });

    emitter.removeAllListeners();
  }

  return { unregisterAll: unregisterAll };
}

// ─── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  registerRemoteSshIpc,
};
