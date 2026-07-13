/**
 * CialloForDesktop - 增强版设置管理器
 *
 * 带版本迁移的设置持久化层，替代旧版 settings.js。
 * 从 clawd-on-desk 的 prefs.js 移植/简化。
 */

const fs = require('fs');
const path = require('path');

const CURRENT_VERSION = 2;

function getDefaults() {
  return {
    version: CURRENT_VERSION,

    // 显示
    modelScale: 0.85,
    alwaysOnTop: true,
    windowOpacity: 1.0,
    clickThrough: false,
    dragEnabled: true,
    clickReaction: true,

    // 动画
    mouseTracking: true,
    expressionCycle: true,
    expressionInterval: 30,
    idleAnimation: true,

    // 系统
    autoStart: false,
    minimizeToTray: true,
    settingsWindowAlwaysOnTop: false,

    // HUD
    enableHUD: false,
    hudShowClock: true,
    hudShowExpressionName: true,
    hudShowStatusIndicators: true,
    hudShowClaudeStatus: true,
    hudShowGreetings: false,
    hudPosition: 'bottom-right',
    hudOpacity: 0.8,

    // 托盘
    showTrayIcon: true,
    closeButtonAction: 'minimize-to-tray',

    // Claude Code 监控
    enableClaudeMonitor: false,
    language: 'zh-CN',
    agentDetectionEnabled: true,
    sessionHudEnabled: false,
    sessionHudPinned: false,
    sessionHudShowLabels: true,

    // SSH
    enableSshRemote: false,
    sshProfiles: [],

    // 权限
    autoApproveAllPermissions: false,
  };
}

function validate(raw) {
  if (!raw || typeof raw !== 'object') return getDefaults();
  const defaults = getDefaults();
  const result = { ...defaults };
  const fields = {
    // Numbers
    modelScale: { type: 'number', min: 0.3, max: 1.5 },
    windowOpacity: { type: 'number', min: 0.3, max: 1.0 },
    expressionInterval: { type: 'number', min: 10, max: 120 },
    hudOpacity: { type: 'number', min: 0.3, max: 1.0 },
    version: { type: 'number' },
    // Strings with enum
    hudPosition: { type: 'string', enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
    closeButtonAction: { type: 'string', enum: ['minimize-to-tray', 'quit'] },
    language: { type: 'string' },
    // Booleans (all the toggles)
    alwaysOnTop: { type: 'boolean' },
    clickThrough: { type: 'boolean' },
    dragEnabled: { type: 'boolean' },
    clickReaction: { type: 'boolean' },
    mouseTracking: { type: 'boolean' },
    expressionCycle: { type: 'boolean' },
    idleAnimation: { type: 'boolean' },
    autoStart: { type: 'boolean' },
    minimizeToTray: { type: 'boolean' },
    settingsWindowAlwaysOnTop: { type: 'boolean' },
    enableHUD: { type: 'boolean' },
    hudShowClock: { type: 'boolean' },
    hudShowExpressionName: { type: 'boolean' },
    hudShowStatusIndicators: { type: 'boolean' },
    hudShowClaudeStatus: { type: 'boolean' },
    hudShowGreetings: { type: 'boolean' },
    showTrayIcon: { type: 'boolean' },
    enableClaudeMonitor: { type: 'boolean' },
    agentDetectionEnabled: { type: 'boolean' },
    sessionHudEnabled: { type: 'boolean' },
    sessionHudPinned: { type: 'boolean' },
    sessionHudShowLabels: { type: 'boolean' },
    enableSshRemote: { type: 'boolean' },
    autoApproveAllPermissions: { type: 'boolean' },
  };

  for (const [key, spec] of Object.entries(fields)) {
    if (raw[key] === undefined) continue;
    const val = raw[key];
    if (spec.type === 'number' && typeof val === 'number') {
      result[key] = val;
      if (spec.min !== undefined) result[key] = Math.max(spec.min, result[key]);
      if (spec.max !== undefined) result[key] = Math.min(spec.max, result[key]);
    } else if (spec.type === 'boolean' && typeof val === 'boolean') {
      result[key] = val;
    } else if (spec.type === 'string' && typeof val === 'string') {
      if (!spec.enum || spec.enum.includes(val)) {
        result[key] = val;
      }
    }
  }

  // SSH profiles validation
  if (Array.isArray(raw.sshProfiles)) {
    result.sshProfiles = raw.sshProfiles.filter(p =>
      p && typeof p === 'object' && typeof p.id === 'string' && typeof p.host === 'string'
    ).map(p => ({
      id: p.id,
      name: p.name || p.host,
      host: p.host,
      port: typeof p.port === 'number' ? Math.max(1, Math.min(65535, p.port)) : 22,
      user: p.user || 'root',
      keyPath: p.keyPath || '',
      autoReconnect: !!p.autoReconnect,
    }));
  }

  result.version = CURRENT_VERSION;
  return result;
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  let out = { ...raw };

  // v0 → v1: 添加 version 字段
  if (!out.version || out.version < 1) {
    out.version = 1;
    if (out.sessionHudEnabled === undefined) out.sessionHudEnabled = false;
    if (out.language === undefined) out.language = 'zh-CN';
    if (out.agentDetectionEnabled === undefined) out.agentDetectionEnabled = true;
  }

  // v1 → v2: 添加 autoApproveAllPermissions
  if (out.version < 2) {
    out.version = 2;
    if (out.autoApproveAllPermissions === undefined) {
      out.autoApproveAllPermissions = false;
    }
  }

  return out;
}

function load(settingsPath) {
  try {
    if (!fs.existsSync(settingsPath)) {
      return getDefaults();
    }
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // 未来版本锁定
    if (raw.version > CURRENT_VERSION) {
      console.warn('[Prefs] Future version detected, returning defaults (locked)');
      return { ...getDefaults(), _locked: true };
    }

    const migrated = migrate(raw);
    return validate(migrated);
  } catch (err) {
    console.error('[Prefs] Load error:', err.message);
    try {
      if (fs.existsSync(settingsPath)) {
        const bakPath = settingsPath + '.bak';
        fs.copyFileSync(settingsPath, bakPath);
      }
    } catch (_) {}
    return getDefaults();
  }
}

function save(settingsPath, snapshot) {
  const validated = validate(snapshot);
  if (validated._locked) return { success: false, error: 'Settings are from a future version' };
  try {
    // 移除内部标记
    const toWrite = { ...validated };
    delete toWrite._locked;
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('[Prefs] Save error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getDefaults, validate, load, save, migrate, CURRENT_VERSION };
