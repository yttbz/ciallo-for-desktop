/**
 * CialloForDesktop - 设置管理器
 *
 * 纯数据层：默认值、加载、保存、验证
 * 存储位置: app.getPath('userData')/ciallo-settings.json
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_VERSION = 1;

/**
 * 默认设置
 */
function getDefaults() {
  return {
    version: SETTINGS_VERSION,

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
    expressionInterval: 30,     // 秒
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
  };
}

/**
 * 验证并规范化设置对象
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

  result.version = SETTINGS_VERSION;
  return result;
}

/**
 * 加载设置
 */
function load(settingsPath) {
  try {
    if (!fs.existsSync(settingsPath)) {
      return getDefaults();
    }
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return validate(raw);
  } catch (err) {
    console.error('[Settings] Load error:', err.message);
    // 备份损坏的文件
    try {
      if (fs.existsSync(settingsPath)) {
        const bakPath = settingsPath + '.bak';
        fs.copyFileSync(settingsPath, bakPath);
      }
    } catch (_) {}
    return getDefaults();
  }
}

/**
 * 保存设置
 */
function save(settingsPath, snapshot) {
  const validated = validate(snapshot);
  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(validated, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('[Settings] Save error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getDefaults, validate, load, save };
