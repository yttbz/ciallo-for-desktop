/**
 * CialloForDesktop - 增强版偏好管理器 (ported from clawd-on-desk)
 *
 * 带版本号迁移的设置管理层：
 *   加载 → 版本检查（未来版本锁定）→ 迁移 → 验证 → 返回
 *   保存 → 验证 → 写入
 *
 * 存储位置: app.getPath('userData')/ciallo-settings.json
 */

const fs = require('fs');
const path = require('path');

const CURRENT_VERSION = 2;

/**
 * 默认设置
 */
function getDefaults() {
  return {
    version: CURRENT_VERSION,

    // 显示
    modelScale: 0.85,           // 0.3 ~ 1.5
    alwaysOnTop: true,
    windowOpacity: 1.0,         // 0.3 ~ 1.0

    // 交互
    clickThrough: false,
    dragEnabled: true,
    clickReaction: true,

    // 动画
    mouseTracking: true,
    expressionCycle: true,
    expressionInterval: 30,     // 10 ~ 120 秒
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
    hudShowGreetings: false,
    hudPosition: 'bottom-right',
    hudOpacity: 0.8,               // 0.3 ~ 1.0

    // 托盘
    showTrayIcon: true,
    closeButtonAction: 'minimize-to-tray',  // 'minimize-to-tray' | 'quit'

    // Claude Code 监控
    enableClaudeMonitor: false,
    hudShowClaudeStatus: true,

    // SSH 远程连接
    enableSshRemote: false,
    sshProfiles: [],

    // 会话 HUD（v2 新增）
    sessionHudEnabled: false,
    sessionHudPinned: false,
    sessionHudShowLabels: true,

    // 杂项（v2 新增）
    language: 'zh-CN',
    agentDetectionEnabled: true,
  };
}

/**
 * 验证并规范化设置对象
 * 类型检查、范围钳制、枚举校验，缺失值用默认值填充
 */
function validate(raw) {
  if (!raw || typeof raw !== 'object') return getDefaults();

  const defaults = getDefaults();
  const result = { ...defaults };

  // 版本号
  if (typeof raw.version === 'number') {
    result.version = raw.version;
  }

  // 显示
  if (typeof raw.modelScale === 'number') {
    result.modelScale = Math.max(0.3, Math.min(1.5, raw.modelScale));
  }
  if (typeof raw.alwaysOnTop === 'boolean') {
    result.alwaysOnTop = raw.alwaysOnTop;
  }
  if (typeof raw.windowOpacity === 'number') {
    result.windowOpacity = Math.max(0.3, Math.min(1.0, raw.windowOpacity));
  }

  // 交互
  if (typeof raw.clickThrough === 'boolean') {
    result.clickThrough = raw.clickThrough;
  }
  if (typeof raw.dragEnabled === 'boolean') {
    result.dragEnabled = raw.dragEnabled;
  }
  if (typeof raw.clickReaction === 'boolean') {
    result.clickReaction = raw.clickReaction;
  }

  // 动画
  if (typeof raw.mouseTracking === 'boolean') {
    result.mouseTracking = raw.mouseTracking;
  }
  if (typeof raw.expressionCycle === 'boolean') {
    result.expressionCycle = raw.expressionCycle;
  }
  if (typeof raw.expressionInterval === 'number') {
    result.expressionInterval = Math.max(10, Math.min(120, raw.expressionInterval));
  }
  if (typeof raw.idleAnimation === 'boolean') {
    result.idleAnimation = raw.idleAnimation;
  }

  // 系统
  if (typeof raw.autoStart === 'boolean') {
    result.autoStart = raw.autoStart;
  }
  if (typeof raw.minimizeToTray === 'boolean') {
    result.minimizeToTray = raw.minimizeToTray;
  }
  if (typeof raw.settingsWindowAlwaysOnTop === 'boolean') {
    result.settingsWindowAlwaysOnTop = raw.settingsWindowAlwaysOnTop;
  }

  // HUD
  if (typeof raw.enableHUD === 'boolean') {
    result.enableHUD = raw.enableHUD;
  }
  if (typeof raw.hudShowClock === 'boolean') {
    result.hudShowClock = raw.hudShowClock;
  }
  if (typeof raw.hudShowExpressionName === 'boolean') {
    result.hudShowExpressionName = raw.hudShowExpressionName;
  }
  if (typeof raw.hudShowStatusIndicators === 'boolean') {
    result.hudShowStatusIndicators = raw.hudShowStatusIndicators;
  }
  if (typeof raw.hudShowGreetings === 'boolean') {
    result.hudShowGreetings = raw.hudShowGreetings;
  }
  if (typeof raw.hudPosition === 'string' && ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(raw.hudPosition)) {
    result.hudPosition = raw.hudPosition;
  }
  if (typeof raw.hudOpacity === 'number') {
    result.hudOpacity = Math.max(0.3, Math.min(1.0, raw.hudOpacity));
  }

  // 托盘
  if (typeof raw.showTrayIcon === 'boolean') {
    result.showTrayIcon = raw.showTrayIcon;
  }
  if (typeof raw.closeButtonAction === 'string' && ['minimize-to-tray', 'quit'].includes(raw.closeButtonAction)) {
    result.closeButtonAction = raw.closeButtonAction;
  }

  // Claude Code 监控
  if (typeof raw.enableClaudeMonitor === 'boolean') {
    result.enableClaudeMonitor = raw.enableClaudeMonitor;
  }
  if (typeof raw.hudShowClaudeStatus === 'boolean') {
    result.hudShowClaudeStatus = raw.hudShowClaudeStatus;
  }

  // SSH 远程连接
  if (typeof raw.enableSshRemote === 'boolean') {
    result.enableSshRemote = raw.enableSshRemote;
  }
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

  // 会话 HUD（v2）
  if (typeof raw.sessionHudEnabled === 'boolean') {
    result.sessionHudEnabled = raw.sessionHudEnabled;
  }
  if (typeof raw.sessionHudPinned === 'boolean') {
    result.sessionHudPinned = raw.sessionHudPinned;
  }
  if (typeof raw.sessionHudShowLabels === 'boolean') {
    result.sessionHudShowLabels = raw.sessionHudShowLabels;
  }

  // 杂项（v2）
  if (typeof raw.language === 'string') {
    result.language = raw.language;
  }
  if (typeof raw.agentDetectionEnabled === 'boolean') {
    result.agentDetectionEnabled = raw.agentDetectionEnabled;
  }

  result.version = CURRENT_VERSION;
  return result;
}

/**
 * 逐版本迁移设置对象
 *
 * v0 → v1: 添加 version 字段，用 v1 默认值回填所有缺失的键
 * v1 → v2: 添加 sessionHudEnabled、sessionHudPinned、sessionHudShowLabels、
 *          language、agentDetectionEnabled
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') {
    return getDefaults();
  }

  let migrated = { ...raw };

  // --- v0 → v1: 初始版本化，回填缺失的 v1 字段 ---
  if (typeof migrated.version !== 'number' || migrated.version < 1) {
    const v1Defaults = getDefaultsV1();
    for (const key of Object.keys(v1Defaults)) {
      if (migrated[key] === undefined) {
        migrated[key] = v1Defaults[key];
      }
    }
    migrated.version = 1;
  }

  // --- v1 → v2: 新增 会话 HUD 和杂项字段 ---
  if (migrated.version < 2) {
    if (migrated.sessionHudEnabled === undefined) migrated.sessionHudEnabled = false;
    if (migrated.sessionHudPinned === undefined) migrated.sessionHudPinned = false;
    if (migrated.sessionHudShowLabels === undefined) migrated.sessionHudShowLabels = true;
    if (migrated.language === undefined) migrated.language = 'zh-CN';
    if (migrated.agentDetectionEnabled === undefined) migrated.agentDetectionEnabled = true;
    migrated.version = 2;
  }

  return migrated;
}

/**
 * 加载设置文件
 *
 * 流程: 读取 JSON → 未来版本锁定检查 → 迁移 → 验证 → 返回
 * 文件损坏: 自动备份为 .bak，返回默认值
 */
function load(settingsPath) {
  try {
    if (!fs.existsSync(settingsPath)) {
      return getDefaults();
    }

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    // 未来版本锁定 —— 防止旧版软件覆写新版软件写入的数据
    if (typeof raw.version === 'number' && raw.version > CURRENT_VERSION) {
      console.warn(
        `[Prefs] Settings version ${raw.version} > current ${CURRENT_VERSION}, ` +
        'locking to prevent data loss'
      );
      return {
        ...getDefaults(),
        locked: true,
        lockedVersion: raw.version,
      };
    }

    const migrated = migrate(raw);
    return validate(migrated);
  } catch (err) {
    console.error('[Prefs] Load error:', err.message);
    backupCorrupt(settingsPath);
    return getDefaults();
  }
}

/**
 * 保存设置
 *   验证 → 写入文件（通过临时文件 + 重命名实现原子写入）
 */
function save(settingsPath, snapshot) {
  const validated = validate(snapshot);
  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 先写入临时文件，再重命名，降低写入中断导致文件损坏的风险
    const tmpPath = settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
    fs.renameSync(tmpPath, settingsPath);

    return { success: true };
  } catch (err) {
    console.error('[Prefs] Save error:', err.message);
    return { success: false, error: err.message };
  }
}

// ---- 内部辅助 ----

/**
 * v1 默认值（仅用于迁移 v0 → v1 时回填缺失字段）
 */
function getDefaultsV1() {
  return {
    version: 1,

    modelScale: 0.85,
    alwaysOnTop: true,
    windowOpacity: 1.0,

    clickThrough: false,
    dragEnabled: true,
    clickReaction: true,

    mouseTracking: true,
    expressionCycle: true,
    expressionInterval: 30,
    idleAnimation: true,

    autoStart: false,
    minimizeToTray: true,
    settingsWindowAlwaysOnTop: false,

    enableHUD: false,
    hudShowClock: true,
    hudShowExpressionName: true,
    hudShowStatusIndicators: true,
    hudShowGreetings: false,
    hudPosition: 'bottom-right',
    hudOpacity: 0.8,

    showTrayIcon: true,
    closeButtonAction: 'minimize-to-tray',

    enableClaudeMonitor: false,
    hudShowClaudeStatus: true,

    enableSshRemote: false,
    sshProfiles: [],
  };
}

/**
 * 备份损坏的设置文件
 */
function backupCorrupt(settingsPath) {
  try {
    if (fs.existsSync(settingsPath)) {
      const bakPath = settingsPath + '.bak';
      fs.copyFileSync(settingsPath, bakPath);
      console.warn(`[Prefs] Corrupt settings backed up to ${bakPath}`);
    }
  } catch (_) {
    // 备份失败不抛异常
  }
}

module.exports = { getDefaults, validate, load, save, migrate, CURRENT_VERSION };
