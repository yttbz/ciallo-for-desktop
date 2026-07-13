/**
 * main/remote-ssh-deploy.js — Remote SSH Hook Deployment
 *
 * Deploys ciallo-hook.js to remote SSH hosts so Claude Code running
 * on those hosts can send events back to the local CialloForDesktop.
 *
 * Creates a reverse SSH tunnel for the remote hook to communicate back.
 *
 * @module main/remote-ssh-deploy
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

/**
 * Resolve absolute path to the hooks directory.
 * @returns {string}
 */
function resolveHooksDir() {
  var devPath = path.join(__dirname, '..', 'hooks');
  if (fs.existsSync(path.join(devPath, 'ciallo-hook.js'))) return devPath;
  try {
    if (process.resourcesPath) {
      var pkgPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'hooks');
      if (fs.existsSync(pkgPath)) return pkgPath;
    }
  } catch (e) {}
  return devPath;
}

/**
 * Build SSH args array from a profile object.
 * @param {object} profile - { host, port, user, keyPath }
 * @returns {string[]}
 */
function buildSshArgs(profile) {
  var args = [];
  if (profile.port && profile.port !== 22) {
    args.push('-p', String(profile.port));
  }
  if (profile.keyPath) {
    args.push('-i', profile.keyPath);
  }
  args.push('-o', 'StrictHostKeyChecking=accept-new');
  args.push('-o', 'ServerAliveInterval=30');
  args.push('-o', 'ServerAliveCountMax=3');
  args.push('-o', 'ConnectTimeout=10');
  args.push((profile.user || 'root') + '@' + profile.host);
  return args;
}

/**
 * Build SCP args array from a profile object.
 * @param {object} profile
 * @returns {string[]}
 */
function buildScpArgs(profile) {
  var args = [];
  args.push('-o', 'StrictHostKeyChecking=accept-new');
  args.push('-o', 'ConnectTimeout=15');
  if (profile.port && profile.port !== 22) {
    args.push('-P', String(profile.port));
  }
  if (profile.keyPath) {
    args.push('-i', profile.keyPath);
  }
  return args;
}

/**
 * Run a command and return a promise of { stdout, stderr, code }.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {Promise<{stdout: string, stderr: string, code: number|null}>}
 */
function runCommand(cmd, args, opts) {
  return new Promise(function (resolve) {
    var child = spawn(cmd, args, opts || { timeout: 30000 });
    var stdout = '';
    var stderr = '';

    child.stdout.on('data', function (chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });

    child.on('close', function (code) {
      resolve({ stdout: stdout, stderr: stderr, code: code });
    });
    child.on('error', function (err) {
      resolve({ stdout: stdout, stderr: stderr + '\n' + err.message, code: -1 });
    });
  });
}

/**
 * Emit progress events through a callback.
 * @param {function} onProgress
 * @param {string} step
 * @param {string} status
 * @param {string} [message]
 */
function emitProgress(onProgress, step, status, message) {
  if (typeof onProgress === 'function') {
    onProgress({ step: step, status: status, message: message || '' });
  }
}

/**
 * Deploy ciallo hooks to a remote SSH host.
 *
 * Steps:
 *   1. verify — check connectivity
 *   2. mkdir — create ~/.ciallo on remote
 *   3. scp — copy hook files
 *   4. install — run remote install script
 *   5. tunnel — set up reverse SSH tunnel
 *
 * @param {object} profile - SSH profile { id, host, port, user, keyPath, remoteForwardPort }
 * @param {object} [options]
 * @param {number} [options.localPort] - Local hook server port
 * @param {function} [options.onProgress] - Progress callback({ step, status, message })
 * @returns {Promise<{success: boolean, message: string}>}
 */
function deployHooks(profile, options) {
  return new Promise(function (resolve) {
    options = options || {};
    var localPort = options.localPort || 18789;
    var onProgress = options.onProgress || null;
    var remoteForwardPort = profile.remoteForwardPort || (localPort + 1000);

    emitProgress(onProgress, 'verify', 'start', '正在验证 SSH 连接...');

    // Step 1: Verify connectivity
    runCommand('ssh', ['-q'].concat(buildSshArgs(profile), ['exit']), { timeout: 15000 })
      .then(function (result) {
        if (result.code !== 0) {
          emitProgress(onProgress, 'verify', 'fail', 'SSH 连接失败: ' + (result.stderr.trim() || 'unknown error'));
          resolve({ success: false, message: 'SSH connection failed: ' + result.stderr.trim() });
          return;
        }
        emitProgress(onProgress, 'verify', 'ok', 'SSH 连接成功');

        emitProgress(onProgress, 'mkdir', 'start', '在远程创建 ~/.ciallo 目录...');
        return runCommand('ssh', buildSshArgs(profile).concat(['mkdir', '-p', '~/.ciallo/hooks']), { timeout: 10000 });
      })
      .then(function (result) {
        if (!result) return;
        if (result.code !== 0) {
          emitProgress(onProgress, 'mkdir', 'fail', '创建目录失败: ' + (result.stderr.trim() || 'unknown'));
          resolve({ success: false, message: 'Failed to create remote directory' });
          return;
        }
        emitProgress(onProgress, 'mkdir', 'ok', '远程目录已创建');

        emitProgress(onProgress, 'scp', 'start', '正在复制 Hook 文件到远程...');

        // Step 2: SCP hook files
        var hooksDir = resolveHooksDir();
        var filesToCopy = ['ciallo-hook.js', 'server-config.js'];
        var scpArgs = buildScpArgs(profile);

        // Build scp command with all files
        var scpFiles = [];
        for (var i = 0; i < filesToCopy.length; i++) {
          var localPath = path.join(hooksDir, filesToCopy[i]);
          if (fs.existsSync(localPath)) {
            scpFiles.push(localPath);
          }
        }

        if (scpFiles.length === 0) {
          emitProgress(onProgress, 'scp', 'fail', '没有找到可复制的 hook 文件');
          resolve({ success: false, message: 'No hook files found to copy' });
          return;
        }

        var remotePath = (profile.user || 'root') + '@' + profile.host + ':.ciallo/hooks/';
        return runCommand('scp', scpArgs.concat(scpFiles, [remotePath]), { timeout: 30000 });
      })
      .then(function (result) {
        if (!result) return;
        if (result.code !== 0) {
          emitProgress(onProgress, 'scp', 'fail', '文件复制失败: ' + (result.stderr.trim() || 'unknown'));
          resolve({ success: false, message: 'Failed to copy hook files' });
          return;
        }
        emitProgress(onProgress, 'scp', 'ok', 'Hook 文件已复制到远程');

        emitProgress(onProgress, 'install', 'start', '在远程安装 Claude Code Hook...');

        // Step 3: Run remote install via ssh
        // Use a heredoc-style approach for the install script
        var installCmd = 'node -e ' + JSON.stringify(
          'var f=require("fs"),p=require("path");' +
          'var h=process.env.HOME;' +
          'var s=JSON.parse(f.readFileSync(p.join(h,".claude","settings.json"),"utf8")||"{}");' +
          's.hooks=s.hooks||{};' +
          'var events=["SessionStart","SessionEnd","UserPromptSubmit","PreToolUse","PostToolUse","PostToolUseFailure","Stop","SubagentStart","SubagentStop","Notification"];' +
          'var c=0;' +
          'var cmd="node "+h+"/.ciallo/hooks/ciallo-hook.js {event}";' +
          'events.forEach(function(e){' +
          '  if(!s.hooks[e]) s.hooks[e]=[];' +
          '  var found=false;' +
          '  (s.hooks[e]||[]).forEach(function(hc){if(hc.indexOf("ciallo-hook.js")>=0)found=true;});' +
          '  if(!found){s.hooks[e].push(cmd);c++;}' +
          '});' +
          'f.writeFileSync(p.join(h,".claude","settings.json"),JSON.stringify(s,null,2));' +
          'console.log("Installed "+c+" hooks");'
        );

        return runCommand('ssh', buildSshArgs(profile).concat([installCmd]), { timeout: 30000 });
      })
      .then(function (result) {
        if (!result) return;
        emitProgress(onProgress, 'install', 'ok', '远程 Hook 安装完成: ' + ((result.stdout || '').trim() || 'done'));

        emitProgress(onProgress, 'tunnel', 'start', '正在建立反向 SSH 隧道...');

        // Step 4: Set up reverse tunnel
        // ssh -N -R <remotePort>:127.0.0.1:<localPort> user@host
        var tunnelArgs = ['-N', '-R', remoteForwardPort + ':127.0.0.1:' + localPort];
        var tunnel = spawn('ssh', tunnelArgs.concat(buildSshArgs(profile)), {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        var tunnelStderr = '';
        tunnel.stderr.on('data', function (chunk) { tunnelStderr += chunk.toString(); });

        // Give the tunnel a moment to connect
        setTimeout(function () {
          if (tunnel.exitCode === null) {
            emitProgress(onProgress, 'tunnel', 'ok', '反向隧道已建立 (端口 ' + remoteForwardPort + ' → localhost:' + localPort + ')');

            // Store tunnel reference for later disconnection
            var connections = options._connectionStore;
            if (connections && connections instanceof Map) {
              connections.set(profile.id, {
                process: tunnel,
                status: 'connected',
                host: profile.host,
                remotePort: remoteForwardPort,
                localPort: localPort,
              });
            }

            resolve({ success: true, message: 'Deploy complete. Tunnel active on port ' + remoteForwardPort });
          } else {
            emitProgress(onProgress, 'tunnel', 'fail', '隧道建立失败: ' + tunnelStderr);
            resolve({ success: false, message: 'Tunnel failed: ' + tunnelStderr });
          }
        }, 3000);
      })
      .catch(function (err) {
        emitProgress(onProgress, 'deploy', 'fail', '部署过程异常: ' + (err.message || 'unknown'));
        resolve({ success: false, message: 'Deploy error: ' + err.message });
      });
  });
}

/**
 * Check if Claude Code is installed on a remote SSH host.
 * @param {object} profile
 * @returns {Promise<{installed: boolean, version: string|null}>}
 */
function checkRemoteClaude(profile) {
  return new Promise(function (resolve) {
    runCommand('ssh', buildSshArgs(profile).concat([
      'which claude 2>/dev/null && claude --version 2>/dev/null || echo "not_found"',
    ]), { timeout: 15000 })
      .then(function (result) {
        var out = result.stdout.trim();
        if (out && out !== 'not_found') {
          var lines = out.split('\n');
          resolve({ installed: true, version: lines[lines.length - 1] || 'unknown' });
        } else {
          resolve({ installed: false, version: null });
        }
      })
      .catch(function () {
        resolve({ installed: false, version: null });
      });
  });
}

/**
 * Check if claude is currently running on a remote host.
 * @param {object} profile
 * @returns {Promise<{running: boolean, sessions: number}>}
 */
function checkRemoteClaudeRunning(profile) {
  return new Promise(function (resolve) {
    runCommand('ssh', buildSshArgs(profile).concat([
      'ps aux 2>/dev/null | grep -c "[c]laude" || echo 0',
    ]), { timeout: 10000 })
      .then(function (result) {
        var count = parseInt(result.stdout.trim(), 10) || 0;
        resolve({ running: count > 0, sessions: count });
      })
      .catch(function () {
        resolve({ running: false, sessions: 0 });
      });
  });
}

module.exports = {
  deployHooks,
  checkRemoteClaude,
  checkRemoteClaudeRunning,
  buildSshArgs,
  buildScpArgs,
  resolveHooksDir,
};
