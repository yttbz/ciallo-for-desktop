/**
 * CialloForDesktop - Renderer 进程
 *
 * 使用 PixiJS + pixi-live2d-display 渲染 Live2D 模型
 * 处理拖拽、交互、动画、鼠标追踪、设置响应
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

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
  // 只留 20px 边缘，让窗口紧贴模型
  const canvasWidth = Math.ceil(bounds.width * scale + 20);
  const canvasHeight = Math.ceil(bounds.height * scale + 20);

  const width = Math.max(150, Math.min(canvasWidth, 800));
  const height = Math.max(200, Math.min(canvasHeight, 1000));

  app.renderer.resize(width, height);

  if (window.electronAPI) {
    window.electronAPI.setSize(width, height);
  }
}

// ======== 交互系统 ========

function initDrag(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (!isLoaded || !dragEnabled) return;

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
    initMouseTracking(canvas);
    initKeyboardShortcuts();
    initResizeHandler();

    // 启动动画
    startExpressionCycle();
    startIdleAnimation();

    // 监听设置变更
    initSettingsListener();

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
