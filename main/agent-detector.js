/**
 * CialloForDesktop - Agent Installation & Process Detection
 *
 * Detects installed AI coding agents (Claude Code, Codex CLI, Gemini CLI)
 * and running agent processes across platforms.
 *
 * Checks configuration paths:
 *   - ~/.claude/settings.json         (Claude Code)
 *   - ~/.codex/config.toml            (Codex CLI)
 *   - ~/.gemini/settings.json         (Gemini CLI)
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const os = require('os');

// ---- Paths ----

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// ---- Agent Definitions ----

const AGENT_CONFIGS = [
  {
    agentId: 'claude-code',
    name: 'Claude Code',
    configPaths: ['~/.claude/settings.json'],
    detectionHints: ['claude', 'claude-code', '.claude'],
    configCheck: (filePath) => {
      // Valid Claude Code settings file exists and is valid JSON
      if (!fs.existsSync(filePath)) return null;
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Presence of any settings key suggests legitimate installation
        if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
          return { detected: true, confidence: 0.9, reason: 'Config file found with valid settings' };
        }
        return { detected: true, confidence: 0.6, reason: 'Config file exists but appears empty' };
      } catch {
        return { detected: true, confidence: 0.4, reason: 'Config file exists but is not valid JSON' };
      }
    },
    processPatterns: {
      linux: ['claude', 'claude-code', 'node.*claude'],
      darwin: ['claude', 'claude-code', 'node.*claude'],
      win32: ['claude.exe', 'claude-code.exe', 'node.exe'],
    },
  },
  {
    agentId: 'codex-cli',
    name: 'Codex CLI',
    configPaths: ['~/.codex/config.toml'],
    detectionHints: ['codex', 'codex-cli', '.codex'],
    configCheck: (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length > 0) {
          return { detected: true, confidence: 0.85, reason: 'Config file found with content' };
        }
        return { detected: true, confidence: 0.5, reason: 'Config file exists but is empty' };
      } catch {
        return { detected: false, confidence: 0, reason: 'Config file exists but is unreadable' };
      }
    },
    processPatterns: {
      linux: ['codex', 'codex-cli'],
      darwin: ['codex', 'codex-cli'],
      win32: ['codex.exe', 'codex-cli.exe'],
    },
  },
  {
    agentId: 'gemini-cli',
    name: 'Gemini CLI',
    configPaths: ['~/.gemini/settings.json'],
    detectionHints: ['gemini', 'gemini-cli', '.gemini'],
    configCheck: (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
          return { detected: true, confidence: 0.85, reason: 'Config file found with valid settings' };
        }
        return { detected: true, confidence: 0.5, reason: 'Config file exists but appears empty' };
      } catch {
        return { detected: true, confidence: 0.4, reason: 'Config file exists but is not valid JSON' };
      }
    },
    processPatterns: {
      linux: ['gemini', 'gemini-cli'],
      darwin: ['gemini', 'gemini-cli'],
      win32: ['gemini.exe', 'gemini-cli.exe'],
    },
  },
];

// ---- Core Functions ----

/**
 * Check if a process ID is still alive by sending signal 0.
 * Cross-platform safe.
 *
 * @param {number} pid
 * @returns {boolean} true if the process exists
 */
function isProcessAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isFinite(pid)) {
    return false;
  }
  try {
    // signal 0 never actually sends a signal, but performs error checking
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH (no such process) or EPERM (permission denied, but process exists)
    return err.code === 'EPERM';
  }
}

/**
 * Detect which AI coding agents are installed on this machine.
 *
 * Checks known configuration file locations and returns an array of
 * detection results with confidence scores and reasons.
 *
 * @returns {Array<{agentId: string, detected: boolean, confidence: number, reason: string}>}
 */
function detectInstalledAgents() {
  const results = [];

  for (const agent of AGENT_CONFIGS) {
    let bestResult = { detected: false, confidence: 0, reason: 'No config files found' };

    for (const configPath of agent.configPaths) {
      const resolved = expandHome(configPath);
      const checkResult = agent.configCheck(resolved);

      if (checkResult !== null && checkResult.confidence > bestResult.confidence) {
        bestResult = checkResult;
      }
    }

    results.push({
      agentId: agent.agentId,
      detected: bestResult.detected,
      confidence: bestResult.confidence,
      reason: bestResult.reason,
    });
  }

  return results;
}

/**
 * Detect currently running AI coding agent processes.
 *
 * Platform-specific detection:
 *   - Windows: Uses PowerShell Get-CimInstance Win32_Process
 *   - Linux/macOS: Uses pgrep -f for pattern matching
 *
 * @returns {Promise<{running: boolean, agents: Array<{agentId: string, name: string, pid: number, command: string}>}>}
 */
async function detectRunningAgentProcesses() {
  const platform = process.platform;

  if (platform === 'win32') {
    return detectWindowsProcesses();
  }

  return detectUnixProcesses(platform);
}

/**
 * Windows: use PowerShell WMI to enumerate processes matching agent names.
 */
async function detectWindowsProcesses() {
  try {
    // Build WMI filter for all agent process names
    const allPatterns = AGENT_CONFIGS.flatMap(a => a.processPatterns.win32);
    const wmiFilter = allPatterns
      .map(name => `Name like '%${name.replace(/\.exe$/i, '')}%'`)
      .join(' or ');

    const psScript = `
      Get-CimInstance Win32_Process |
        Where-Object { ${wmiFilter} } |
        Select-Object ProcessId, Name, CommandLine |
        ConvertTo-Json -Compress
    `;

    const stdout = execSync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`,
      { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!stdout || stdout === 'null') {
      return { running: false, agents: [] };
    }

    let processes;
    try {
      processes = JSON.parse(stdout);
    } catch {
      return { running: false, agents: [] };
    }

    // Normalize to array (single result vs array)
    if (!Array.isArray(processes)) {
      processes = processes ? [processes] : [];
    }

    const agents = [];
    for (const proc of processes) {
      const pid = parseInt(proc.ProcessId, 10);
      const name = proc.Name || '';
      const commandLine = proc.CommandLine || '';

      const matchedAgent = AGENT_CONFIGS.find(a =>
        a.processPatterns.win32.some(p => name.toLowerCase().includes(p.replace('.exe', '').toLowerCase()))
      );

      if (matchedAgent && !isNaN(pid)) {
        agents.push({
          agentId: matchedAgent.agentId,
          name: proc.Name,
          pid,
          command: commandLine,
        });
      }
    }

    return { running: agents.length > 0, agents };
  } catch (err) {
    console.error('[AgentDetector] Windows process detection error:', err.message);
    return { running: false, agents: [] };
  }
}

/**
 * Linux/macOS: use pgrep -f with pattern matching.
 * Falls back to `ps aux | grep` on systems without pgrep.
 */
async function detectUnixProcesses(platform) {
  try {
    const allPatterns = AGENT_CONFIGS.flatMap(a => a.processPatterns[platform] || a.processPatterns.linux);

    // Build pgrep alternation pattern
    const pattern = allPatterns
      .map(p => `(${p})`)
      .join('|');

    // Use pgrep -f for full command-line matching, get PIDs and commands
    let stdout;
    try {
      stdout = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // pgrep not available, fall back to ps aux | grep
      stdout = execSync(
        `ps aux 2>/dev/null | grep -E "${pattern}" | grep -v grep || true`,
        { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    }

    if (!stdout) {
      return { running: false, agents: [] };
    }

    // pgrep -f outputs lines like: "12345 node /path/to/claude"
    // Or with -l flag on some systems: "12345 command args..."
    const lines = stdout.split('\n').filter(l => l.trim());

    // Use ps to get detailed info from PIDs
    const pids = [];
    const seenPids = new Set();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      if (!isNaN(pid) && !seenPids.has(pid)) {
        seenPids.add(pid);
        pids.push(pid);
      }
    }

    if (pids.length === 0) {
      return { running: false, agents: [] };
    }

    // Get command lines for found PIDs
    const agents = [];
    for (const pid of pids) {
      try {
        const cmdLine = execSync(`ps -p ${pid} -o comm= -o args= 2>/dev/null || true`, {
          timeout: 2000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        const matchedAgent = AGENT_CONFIGS.find(a => {
          const patterns = a.processPatterns[platform] || a.processPatterns.linux;
          return patterns.some(p => {
            const regex = new RegExp(p.replace(/\*/g, '.*'), 'i');
            return regex.test(cmdLine);
          });
        });

        if (matchedAgent) {
          agents.push({
            agentId: matchedAgent.agentId,
            name: cmdLine.split(/\s+/)[0] || 'unknown',
            pid,
            command: cmdLine,
          });
        }
      } catch {
        // Process may have exited between pgrep and ps
        continue;
      }
    }

    return { running: agents.length > 0, agents };
  } catch (err) {
    console.error('[AgentDetector] Unix process detection error:', err.message);
    return { running: false, agents: [] };
  }
}

/**
 * Quick synchronous check for whether any agent process is running.
 * Useful for polling without async overhead.
 *
 * @returns {{ running: boolean, count: number }}
 */
function detectRunningAgentProcessesSync() {
  const platform = process.platform;
  const allPatterns = AGENT_CONFIGS.flatMap(a => a.processPatterns[platform] || a.processPatterns.linux);

  try {
    if (platform === 'win32') {
      // Minimal Windows check via tasklist
      const stdout = execSync(
        `tasklist /FO CSV /NH 2>nul`,
        { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      let count = 0;
      for (const line of lines) {
        const name = line.split(',')[0]?.replace(/"/g, '').toLowerCase();
        if (allPatterns.some(p => name.includes(p.replace('.exe', '').toLowerCase()))) {
          count++;
        }
      }
      return { running: count > 0, count };
    }

    // Linux/macOS: pgrep
    const pattern = allPatterns.map(p => `(${p})`).join('|');
    let stdout;
    try {
      stdout = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      stdout = '';
    }

    const lines = stdout ? stdout.split('\n').filter(l => l.trim()) : [];
    return { running: lines.length > 0, count: lines.length };
  } catch {
    return { running: false, count: 0 };
  }
}

module.exports = {
  detectInstalledAgents,
  detectRunningAgentProcesses,
  detectRunningAgentProcessesSync,
  isProcessAlive,
};
