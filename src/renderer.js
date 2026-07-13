/**
 * CialloForDesktop - Renderer 进程
 *
 * 使用 PixiJS + pixi-live2d-display 渲染 Live2D 模型
 * 处理拖拽、交互、动画、鼠标追踪、设置响应
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { playCialloChime, playNotification, playComplete } from './notification-sound.js';

// ======== 全局状态 ========

let app = null;
let model = null;
let isDragging = false;
let dragStartScreen = { x: 0, y: 0 };
let dragStartWindow = { x: 0, y: 0 };
let dragMoved = false;
let isLoaded = false;
let expressionTimer = null;
let idleAnimationTicker = null;
let mouseTrackingEnabled = true;
let dragEnabled = true;
let clickReactionEnabled = true;
let expressionCycleEnabled = true;
let expressionCycleInterval = 30;
let idleAnimationEnabled = true;
let modelScaleSetting = 0.85;

// HUD 状态
let hudContainer = null;
let hudBg = null;
let hudClockText = null;
let hudExpressionText = null;
let hudStatusText = null;
let hudClaudeText = null;     // Claude Code 状态
let hudGreetingText = null;
let hudGreetingTimer = null;
let hudClockInterval = null;
let currentExpressionName = '01_LianHei';
let isClickThrough = false;
let claudeMonitorRunning = false;
let hudSettings = {
  enableHUD: false,
  hudShowClock: true,
  hudShowExpressionName: true,
  hudShowStatusIndicators: true,
  hudShowClaudeStatus: true,
  hudShowGreetings: false,
  hudPosition: 'bottom-right',
  hudOpacity: 0.8,
};

const GREETINGS = [
  'Ciallo～(∠?ω< )⌒★!',
  '今日も一緒に遊ぼう！',
  'いい天気ですね〜',
  'お仕事お疲れさまです',
  'こんにちは〜',
  '一緒にいてくれてありがとう',
  'ずっと見ていてね',
];

// 表情列表 (与 model3.json 中的 Name 对应)
const EXPRESSIONS = [
  '01_LianHei',   // 脸黑
  '02_LianHei2',  // 脸黑2
  '03_GaoGuang',  // 高光
  '04_LiuHan',    // 流汗
  '05_LianHong',  // 脸红
  '06_KuMei',     // 哭眉
  '07_HengYan',   // 横眼
  '08_qYan',      // Q眼
];

const NEUTRAL_EXPRESSION = '01_LianHei';

// ======== 工具函数 ========

function showError(message) {
  const errorDiv = document.getElementById('error');
  const errorDetail = document.getElementById('errorDetail');
  if (errorDiv && errorDetail) {
    errorDiv.style.display = 'flex';
    errorDetail.textContent = message;
  }
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  console.error('[Ciallo] Error:', message);
}

function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
}

// ======== PixiJS 初始化 ========

function initPixi() {
  window.PIXI = PIXI;
  Live2DModel.registerTicker(PIXI.Ticker);

  app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: true,
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
  });

  document.getElementById('canvas-container').appendChild(app.view);

  const canvas = app.view;
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  return canvas;
}

// ======== 模型加载 ========

async function loadModel() {
  const modelUrl = '../assets/model/Murasame_Yukata/murasame_yukata.model3.json';

  try {
    model = await Live2DModel.from(modelUrl);
  } catch (err) {
    showError('无法加载 Live2D 模型: ' + err.message);
    throw err;
  }

  model.anchor.set(0.5, 0.5);

  // 计算初始缩放
  applyModelScale(modelScaleSetting);

  app.stage.addChild(model);

  model.autoUpdate = true;

  // 等待模型完全加载
  await new Promise((resolve) => {
    if (model.internalModel) {
      resolve();
    } else {
      model.once('ready', resolve);
    }
  });

  isLoaded = true;
  hideLoading();

  // 追踪当前表情名称（HUD 使用）
  if (model.expression) {
    const origExpression = model.expression.bind(model);
    model.expression = async (expr) => {
      currentExpressionName = expr;
      updateHudExpression();
      return origExpression(expr);
    };
  }

  adjustWindowSize();
  return model;
}

/**
 * 应用模型缩放
 */
function applyModelScale(scaleRatio) {
  if (!model) return;
  const bounds = model.getLocalBounds();
  const modelWidth = bounds.width;
  const modelHeight = bounds.height;

  // 以窗口 85% 宽度为基准
  const baseScaleX = (window.innerWidth * 0.85) / modelWidth;
  const baseScaleY = (window.innerHeight * 0.80) / modelHeight;
  const baseScale = Math.min(baseScaleX, baseScaleY, 1.0);

  // 应用用户设置的缩放比例
  const finalScale = baseScale * scaleRatio;

  model.scale.set(finalScale);

  // 居中放置 (让模型在窗口正中间)
  model.position.set(
    window.innerWidth / 2,
    window.innerHeight / 2
  );

  adjustWindowSize();
}

/**
 * 调整窗口大小以适应模型
 */
function adjustWindowSize() {
  if (!model || !app) return;

  const bounds = model.getLocalBounds();
  const scale = model.scale.x;
  // 留 60px 边缘，避免 Windows 阴影裁剪（原为 20px）
  const padding = 60;
  const canvasWidth = Math.ceil(bounds.width * scale + padding);
  const canvasHeight = Math.ceil(bounds.height * scale + padding);

  const width = Math.max(150, Math.min(canvasWidth, 800));
  const height = Math.max(200, Math.min(canvasHeight, 1000));

  app.renderer.resize(width, height);

  // 😤 关键修复：resize 后重新居中模型，
  // 否则模型位置基于旧窗口中心，脚部会被裁剪
  model.position.set(width / 2, height / 2);

  if (window.electronAPI) {
    window.electronAPI.setSize(width, height);
  }
}

// ======== 交互系统 ========

function initDrag(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    // 仅左键 (button === 0) 触发拖拽，右键留给 contextmenu
    if (e.button !== 0 || !isLoaded || !dragEnabled) return;

    isDragging = true;
    dragMoved = false;
    dragStartScreen = { x: e.screenX, y: e.screenY };

    if (window.electronAPI) {
      window.electronAPI.getPosition().then((pos) => {
        dragStartWindow = pos;
      });
    }

    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !window.electronAPI) return;
    if (e.buttons === 0) {
      isDragging = false;
      canvas.style.cursor = 'default';
      return;
    }

    const dx = e.screenX - dragStartScreen.x;
    const dy = e.screenY - dragStartScreen.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMoved = true;
      window.electronAPI.moveWindowBy(dx, dy);
      dragStartScreen = { x: e.screenX, y: e.screenY };
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';
      if (!dragMoved && isLoaded && model && clickReactionEnabled) {
        handleClick();
      }
    }
  });
}

function handleClick() {
  if (!model) return;

  if (Math.random() < 0.5) {
    const idx = Math.floor(Math.random() * EXPRESSIONS.length);
    model.expression(EXPRESSIONS[idx]).catch(() => {});
  }

  if (Math.random() < 0.2) {
    setTimeout(() => {
      model.expression('05_LianHong').catch(() => {});
      setTimeout(() => {
        model.expression('01_LianHei').catch(() => {});
      }, 2000);
    }, 100);
  }
}

/**
 * 鼠标追踪 (眼睛跟随)
 */
function initMouseTracking(canvas) {
  let lastFocusTime = 0;

  canvas.addEventListener('mousemove', (e) => {
    if (!isLoaded || !model || isDragging || !mouseTrackingEnabled) return;

    const now = Date.now();
    if (now - lastFocusTime < 33) return;
    lastFocusTime = now;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const focusX = (x - 0.5) * 3;
    const focusY = (y - 0.5) * 2;

    model.focus(focusX, focusY);
  });

  canvas.addEventListener('mouseleave', () => {
    if (model) {
      model.focus(0, 0);
    }
  });
}

// ======== 动画系统 ========

function startExpressionCycle() {
  clearTimeout(expressionTimer);

  const scheduleNext = () => {
    if (!expressionCycleEnabled || !isLoaded || !model) return;

    const delay = Math.max(expressionCycleInterval * 1000, 10000);
    expressionTimer = setTimeout(() => {
      if (!isLoaded || !model || !expressionCycleEnabled) return;

      const idx = Math.floor(Math.random() * EXPRESSIONS.length);
      model.expression(EXPRESSIONS[idx]).catch(() => {});
      console.log('[Ciallo] Expression:', EXPRESSIONS[idx]);

      scheduleNext();
    }, delay);
  };

  if (expressionCycleEnabled) {
    scheduleNext();
  }
}

function startIdleAnimation() {
  let tick = 0;

  idleAnimationTicker = () => {
    if (!isLoaded || !model || !idleAnimationEnabled) return;

    tick += 0.02;

    if (model.internalModel && model.internalModel.coreModel) {
      try {
        const breath = Math.sin(tick) * 8;
        model.internalModel.coreModel.setParameterValueById('ParamBodyAngleZ', breath);
        model.internalModel.coreModel.setParameterValueById(
          'ParamBreath',
          Math.sin(tick * 0.5) * 0.5 + 0.5
        );
      } catch (e) {
        // 忽略参数错误
      }
    }
  };

  app.ticker.add(idleAnimationTicker);
}

// ======== 设置管理与响应 ========

/**
 * 从主进程加载初始设置
 */
async function loadInitialSettings() {
  if (!window.electronAPI) return;
  try {
    const settings = await window.electronAPI.getSettings();
    if (settings) {
      applySettings(settings);
    }
  } catch (e) {
    console.warn('[Ciallo] Failed to load settings:', e.message);
  }
}

/**
 * 应用设置变更
 */
function applySettings(settings) {
  if (!settings) return;

  // 模型缩放
  if (settings.modelScale !== undefined && settings.modelScale !== modelScaleSetting) {
    modelScaleSetting = settings.modelScale;
    if (isLoaded && model) {
      applyModelScale(modelScaleSetting);
    }
  }

  // 交互
  if (settings.dragEnabled !== undefined) {
    dragEnabled = settings.dragEnabled;
  }
  if (settings.clickReaction !== undefined) {
    clickReactionEnabled = settings.clickReaction;
  }

  // 鼠标追踪
  if (settings.mouseTracking !== undefined) {
    mouseTrackingEnabled = settings.mouseTracking;
  }

  // 表情自动切换
  if (settings.expressionCycle !== undefined) {
    expressionCycleEnabled = settings.expressionCycle;
    if (isLoaded) {
      if (expressionCycleEnabled) {
        startExpressionCycle();
      } else {
        clearTimeout(expressionTimer);
      }
    }
  }

  // 表情切换间隔
  if (settings.expressionInterval !== undefined) {
    expressionCycleInterval = settings.expressionInterval;
    if (isLoaded && expressionCycleEnabled) {
      startExpressionCycle(); // 重新调度
    }
  }

  // Idle 动画
  if (settings.idleAnimation !== undefined) {
    idleAnimationEnabled = settings.idleAnimation;
  }

  // 点击穿透状态同步（HUD 显示用）
  if (settings.clickThrough !== undefined) {
    isClickThrough = settings.clickThrough;
    if (hudStatusText) updateHudStatus();
  }

  // 鼠标追踪状态同步（HUD 显示用）
  if (settings.mouseTracking !== undefined) {
    if (hudStatusText) updateHudStatus();
  }

  // HUD 设置
  applyHudSettings(settings);
}

/**
 * 监听设置变更
 */
function initSettingsListener() {
  if (window.electronAPI && window.electronAPI.onSettingsChanged) {
    window.electronAPI.onSettingsChanged((settings) => {
      applySettings(settings);
    });
  }
}

// ======== 宠物状态映射（从 clawd-on-desk 状态机接收） ========

/**
 * 状态机状态 → Live2D 表情映射表
 */
const STATE_TO_EXPRESSION = {
  'idle':         '01_LianHei',    // 默认表情
  'working':      '02_LianHei2',   // 工作/忙碌
  'thinking':     '03_GaoGuang',   // 思考中
  'attention':    '05_LianHong',   // 完成时脸红
  'notification': '04_LiuHan',     // 需要用户操作(流汗)
  'sleeping':     '01_LianHei',    // 空闲休眠
  'juggling':     '06_KuMei',      // 多任务处理
  'yawning':      '07_HengYan',    // 要打哈欠了
};

function initPetStateListener() {
  if (window.electronAPI && window.electronAPI.onPetState) {
    window.electronAPI.onPetState((stateName) => {
      const expression = STATE_TO_EXPRESSION[stateName];
      if (expression && model) {
        model.expression(expression).catch(() => {});
        if (hudExpressionText) {
          const names = {
            '01_LianHei': '普通', '02_LianHei2': '普通2',
            '03_GaoGuang': '高光', '04_LiuHan': '流汗',
            '05_LianHong': '脸红', '06_KuMei': '哭眉',
            '07_HengYan': '横眼', '08_qYan': 'Q眼',
          };
          hudExpressionText.text = `状态: ${names[expression] || expression}`;
          if (hudContainer && hudContainer.visible) layoutHud();
        }
        // 播放 Ciallo 提示音
        if (stateName === 'attention') {
          playComplete();
        } else if (stateName === 'notification') {
          playCialloChime();
        }
      }
    });
  }
}

// ======== 窗口自适应 ========

function initResizeHandler() {
  window.addEventListener('resize', () => {
    if (app) {
      app.renderer.resize(window.innerWidth, window.innerHeight);
    }
    if (model) {
      // 居中放置
      model.position.set(
        window.innerWidth / 2,
        window.innerHeight / 2
      );
    }
    if (hudContainer && hudContainer.visible) {
      layoutHud();
    }
  });
}

// ======== HUD 系统 ========

function initHud() {
  if (!app || hudContainer) return;

  hudContainer = new PIXI.Container();
  hudContainer.visible = false;

  // 背景面板
  hudBg = new PIXI.Graphics();

  // 文本样式
  const textStyle = new PIXI.TextStyle({
    fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    fontSize: 13,
    fill: '#ffffff',
    fontWeight: '500',
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 4,
    dropShadowDistance: 1,
  });

  hudClockText = new PIXI.Text('', textStyle);
  hudExpressionText = new PIXI.Text('', textStyle);

  const statusStyle = new PIXI.TextStyle({
    fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    fontSize: 11,
    fill: '#cccccc',
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 3,
    dropShadowDistance: 1,
  });
  hudStatusText = new PIXI.Text('', statusStyle);

  // Claude Code 状态文本（相同样式，绿色调）
  hudClaudeText = new PIXI.Text('', new PIXI.TextStyle({
    fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    fontSize: 11,
    fill: '#66ff99',
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 3,
    dropShadowDistance: 1,
  }));
  hudClaudeText.visible = false;

  const greetingStyle = new PIXI.TextStyle({
    fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    fontSize: 14,
    fill: '#ff99bb',
    fontWeight: '700',
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 6,
    dropShadowDistance: 1,
  });
  hudGreetingText = new PIXI.Text('', greetingStyle);
  hudGreetingText.alpha = 0;
  hudGreetingText.visible = false;

  // 添加子元素：背景 + 文本
  hudContainer.addChild(hudBg);
  hudContainer.addChild(hudClockText);
  hudContainer.addChild(hudExpressionText);
  hudContainer.addChild(hudStatusText);
  hudContainer.addChild(hudClaudeText);
  hudContainer.addChild(hudGreetingText);

  app.stage.addChild(hudContainer);

  // 启动时钟更新
  hudClockInterval = setInterval(updateHudClock, 1000);
  updateHudClock();

  // 启动问候语系统
  if (hudSettings.hudShowGreetings) {
    scheduleNextGreeting();
  }
}

function layoutHud() {
  if (!hudContainer || !app) return;

  const padding = 10;
  const lineHeight = 20;

  // 收集可见文本行
  const lines = [];
  if (hudSettings.hudShowClock) {
    hudClockText.visible = true;
    lines.push(hudClockText);
  } else {
    hudClockText.visible = false;
  }
  if (hudSettings.hudShowExpressionName) {
    hudExpressionText.visible = true;
    lines.push(hudExpressionText);
  } else {
    hudExpressionText.visible = false;
  }
  if (hudSettings.hudShowStatusIndicators) {
    hudStatusText.visible = true;
    lines.push(hudStatusText);
  } else {
    hudStatusText.visible = false;
  }

  // Claude Code 状态（设置开启时有数据才显示）
  if (hudSettings.hudShowClaudeStatus && hudClaudeText && hudClaudeText.text) {
    hudClaudeText.visible = true;
    lines.push(hudClaudeText);
  } else if (hudClaudeText) {
    hudClaudeText.visible = false;
  }

  // 计算面板尺寸
  const maxWidth = Math.max(
    ...lines.filter(t => t.visible).map(t => t.width),
    hudGreetingText.visible ? hudGreetingText.width : 0,
    100
  );
  const visibleLines = lines.filter(t => t.visible);
  const panelHeight = visibleLines.length * lineHeight + padding * 2 + (hudGreetingText.visible ? lineHeight + 4 : 0);
  const panelWidth = Math.min(maxWidth + padding * 2, app.renderer.width - padding * 2);
  const windowW = app.renderer.width;
  const windowH = app.renderer.height;

  // 确定位置
  let panelX, panelY;
  switch (hudSettings.hudPosition) {
    case 'top-left': panelX = padding; panelY = padding; break;
    case 'top-right': panelX = windowW - panelWidth - padding; panelY = padding; break;
    case 'bottom-left': panelX = padding; panelY = windowH - panelHeight - padding; break;
    case 'bottom-right':
    default: panelX = windowW - panelWidth - padding; panelY = windowH - panelHeight - padding; break;
  }

  // 绘制半透明背景
  hudBg.clear();
  hudBg.beginFill(0x000000, 1 - hudSettings.hudOpacity);
  hudBg.drawRoundedRect(0, 0, panelWidth, panelHeight, 6);
  hudBg.endFill();
  hudBg.position.set(panelX, panelY);

  // 定位文本行
  let yPos = padding;
  for (const text of lines) {
    text.position.set(panelX + padding, panelY + yPos);
    yPos += lineHeight;
  }

  // 问候语在面板下方
  hudGreetingText.position.set(panelX + padding, panelY + yPos + 4);
}

function updateHudClock() {
  if (!hudClockText) return;
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  hudClockText.text = `${hours}:${minutes}:${seconds}`;
}

function updateHudExpression() {
  if (!hudExpressionText) return;
  const names = {
    '01_LianHei': '普通',
    '02_LianHei2': '普通2',
    '03_GaoGuang': '高光',
    '04_LiuHan': '流汗',
    '05_LianHong': '脸红',
    '06_KuMei': '哭眉',
    '07_HengYan': '横眼',
    '08_qYan': 'Q眼',
  };
  const displayName = names[currentExpressionName] || currentExpressionName;
  hudExpressionText.text = `表情: ${displayName}`;
  if (hudContainer && hudContainer.visible) layoutHud();
}

function updateHudStatus() {
  if (!hudStatusText) return;
  const indicators = [];
  if (isClickThrough) indicators.push('穿透: 开');
  if (mouseTrackingEnabled) indicators.push('追踪: 开');
  hudStatusText.text = indicators.join(' | ') || '状态: 默认';
  if (hudContainer && hudContainer.visible) layoutHud();
}

/**
 * 更新 HUD 的 Claude Code 状态显示
 */
function updateHudClaudeStatus(status) {
  if (!hudClaudeText) return;
  if (status && status.running) {
    hudClaudeText.text = `🤖 Claude: ${status.sessions} 会话`;
    hudClaudeText.style.fill = '#66ff99'; // 绿色 - 运行中
  } else if (status) {
    hudClaudeText.text = '🤖 Claude: 空闲';
    hudClaudeText.style.fill = '#999999'; // 灰色 - 空闲
  } else {
    hudClaudeText.text = '';
    hudClaudeText.visible = false;
  }
  if (hudContainer && hudContainer.visible) layoutHud();
}

/**
 * 初始化 Claude Code 状态监听
 */
function initClaudeMonitor() {
  if (window.electronAPI && window.electronAPI.onClaudeStatus) {
    // 先拉取一次当前状态
    window.electronAPI.getClaudeStatus().then((status) => {
      if (status) {
        claudeMonitorRunning = true;
        updateHudClaudeStatus(status);
      }
    }).catch(() => {});
    // 监听后续推送
    window.electronAPI.onClaudeStatus((status) => {
      if (status) {
        claudeMonitorRunning = true;
        updateHudClaudeStatus(status);
      }
    });
  }
}

function scheduleNextGreeting() {
  if (hudGreetingTimer) clearTimeout(hudGreetingTimer);
  if (!hudSettings.hudShowGreetings) return;

  const delay = 15000 + Math.random() * 30000;
  hudGreetingTimer = setTimeout(showGreeting, delay);
}

function showGreeting() {
  if (!hudGreetingText || !hudContainer || !app) return;

  const msg = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  hudGreetingText.text = msg;
  hudGreetingText.alpha = 0;
  hudGreetingText.visible = true;

  let fadeStep = 0;
  const fadeDuration = 30;
  let phase = 'fadein';
  layoutHud();

  const tickerFn = () => {
    if (!hudGreetingText) return;

    fadeStep++;
    if (phase === 'fadein') {
      hudGreetingText.alpha = Math.min(1, fadeStep / fadeDuration);
      if (fadeStep >= fadeDuration) { phase = 'hold'; fadeStep = 0; }
    } else if (phase === 'hold') {
      if (fadeStep >= 180) { phase = 'fadeout'; fadeStep = 0; }
    } else if (phase === 'fadeout') {
      hudGreetingText.alpha = Math.max(0, 1 - fadeStep / fadeDuration);
      if (fadeStep >= fadeDuration) {
        hudGreetingText.visible = false;
        hudGreetingText.alpha = 0;
        app.ticker.remove(tickerFn);
        layoutHud();
        scheduleNextGreeting();
        return;
      }
    }
  };

  app.ticker.add(tickerFn);
}

function applyHudSettings(settings) {
  if (!settings) return;

  let changed = false;
  const hudKeys = [
    'enableHUD', 'hudShowClock', 'hudShowExpressionName',
    'hudShowStatusIndicators', 'hudShowClaudeStatus', 'hudShowGreetings',
    'hudPosition', 'hudOpacity',
  ];

  for (const key of hudKeys) {
    if (settings[key] !== undefined && settings[key] !== hudSettings[key]) {
      hudSettings[key] = settings[key];
      changed = true;
    }
  }

  if (!changed) return;

  if (hudContainer) {
    hudContainer.visible = hudSettings.enableHUD;

    if (hudSettings.enableHUD) {
      // 更新子元素可见性
      hudClockText.visible = hudSettings.hudShowClock;
      hudExpressionText.visible = hudSettings.hudShowExpressionName;
      hudStatusText.visible = hudSettings.hudShowStatusIndicators;

      if (!hudSettings.hudShowGreetings) {
        hudGreetingText.visible = false;
        hudGreetingText.alpha = 0;
        if (hudGreetingTimer) clearTimeout(hudGreetingTimer);
      } else if (!hudGreetingText.visible && !hudGreetingTimer) {
        scheduleNextGreeting();
      }

      layoutHud();
    } else {
      if (hudGreetingTimer) clearTimeout(hudGreetingTimer);
    }
  } else if (hudSettings.enableHUD) {
    initHud();
  }
}

// ======== 右键上下文菜单 ========

function initContextMenu(canvas) {
  // 右键 → 弹出系统托盘菜单
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.showContextMenu) {
      window.electronAPI.showContextMenu();
    }
  });
}

// ======== 键盘快捷键 ========

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      if (window.electronAPI) {
        window.electronAPI.toggleClickThrough();
      }
    }
    if (e.key === 'Escape') {
      if (model) {
        model.expression(NEUTRAL_EXPRESSION).catch(() => {});
      }
    }
    const num = parseInt(e.key);
    if (num >= 1 && num <= 8 && model) {
      model.expression(EXPRESSIONS[num - 1]).catch(() => {});
    }
  });
}

// ======== 版权信息 ========

function showCredit() {
  console.log(
    '%c CialloForDesktop ',
    'background: #ff6699; color: white; font-size: 16px; padding: 4px 8px; border-radius: 4px;'
  );
  console.log('模型: 浴衣丛雨 (Murasame Yukata)');
  console.log('版权: © ゆずソフト (Yuzu-Soft)');
  console.log('仅供个人使用，请勿用于直播或商业用途');
  console.log('官方网站: https://m1f.cn');
}

// ======== 启动 ========

async function main() {
  try {
    showCredit();

    if (typeof Live2DCubismCore === 'undefined') {
      showError('Cubism Web Core 未加载。请运行 node scripts/download-cubism-core.js');
      return;
    }

    const ver = Live2DCubismCore.Version.csmGetVersion();
    const major = (ver >> 24) & 0xFF;
    const minor = (ver >> 16) & 0xFF;
    const patch = ver & 0xFFFF;
    console.log(`[Ciallo] Cubism Core version: ${major}.${minor}.${patch} (${ver})`);

    // 加载初始设置
    await loadInitialSettings();

    // 初始化 PixiJS
    const canvas = initPixi();
    console.log('[Ciallo] PixiJS initialized');

    // 加载 Live2D 模型
    await loadModel();
    console.log('[Ciallo] Model loaded');

    // 初始化交互
    initDrag(canvas);
    initContextMenu(canvas);
    initMouseTracking(canvas);
    initKeyboardShortcuts();
    initResizeHandler();

    // 初始化 HUD
    initHud();

    // 启动动画
    startExpressionCycle();
    startIdleAnimation();

    // 监听设置变更
    initSettingsListener();

    // 宠物状态监听（来自状态机）
    initPetStateListener();

    // Claude Code 监控
    initClaudeMonitor();

    if (window.electronAPI) {
      window.electronAPI.ready();
    }

    console.log('[Ciallo] Ready! Ciallo～(∠?ω< )⌒★!');
  } catch (err) {
    console.error('[Ciallo] Fatal error:', err);
    showError(err.message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
