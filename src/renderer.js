/**
 * CialloForDesktop - Renderer 进程
 *
 * 使用 PixiJS + pixi-live2d-display 渲染 Live2D 模型
 * 处理拖拽、交互、动画、鼠标追踪
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

// ======== 全局状态 ========

let app = null;
let model = null;
let isDragging = false;
let dragStartScreen = { x: 0, y: 0 };
let dragStartWindow = { x: 0, y: 0 };
let dragMoved = false;
let isLoaded = false;
let expressionTimer = null;

// 表情列表 (与 model3.json 中的 Name 对应)
const EXPRESSIONS = [
  '01_LianHei',   // 脸黑 (生气)
  '02_LianHei2',  // 脸黑2
  '03_GaoGuang',  // 高光 (闪亮)
  '04_LiuHan',    // 流汗
  '05_LianHong',  // 脸红
  '06_KuMei',     // 哭眉
  '07_HengYan',   // 横眼
  '08_qYan',      // Q眼 (可爱)
];

// 中性表情对应的参数重置值
const NEUTRAL_EXPRESSION = '01_LianHei';

// ======== 工具函数 ========

/**
 * 显示错误信息
 */
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

/**
 * 隐藏加载提示
 */
function hideLoading() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
}

// ======== PixiJS 初始化 ========

function initPixi() {
  // 暴露 PIXI 全局变量 (pixi-live2d-display 需要)
  window.PIXI = PIXI;

  // 注册 Ticker
  Live2DModel.registerTicker(PIXI.Ticker);

  app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    transparent: true,
    antialias: true,
    autoStart: true,
    backgroundColor: null,
    resolution: window.devicePixelRatio || 1,
    autoResize: true,
  });

  document.getElementById('canvas-container').appendChild(app.view);

  // 设置画布样式
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

  // 设置锚点
  model.anchor.set(0.5, 0.5);

  // 获取模型原始尺寸并计算缩放
  const bounds = model.getLocalBounds();
  const modelWidth = bounds.width;
  const modelHeight = bounds.height;

  // 计算缩放比，使模型适配窗口
  const scaleX = (window.innerWidth * 0.85) / modelWidth;
  const scaleY = (window.innerHeight * 0.80) / modelHeight;
  const scale = Math.min(scaleX, scaleY, 1.0);

  model.scale.set(scale);

  // 居中偏下放置
  model.position.set(
    window.innerWidth / 2,
    window.innerHeight - modelHeight * scale * 0.45
  );

  app.stage.addChild(model);

  // 启用自动更新
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

  // 调整窗口大小以适应模型
  adjustWindowSize();

  return model;
}

/**
 * 调整窗口大小以适应模型
 */
function adjustWindowSize() {
  if (!model || !app) return;

  const bounds = model.getLocalBounds();
  const scale = model.scale.x;
  const canvasWidth = Math.ceil(bounds.width * scale + 60);
  const canvasHeight = Math.ceil(bounds.height * scale + 80);

  // 限制最小尺寸
  const width = Math.max(200, Math.min(canvasWidth, 800));
  const height = Math.max(300, Math.min(canvasHeight, 1000));

  // 调整 Canvas 大小
  app.renderer.resize(width, height);

  // 通知主进程调整窗口大小
  if (window.electronAPI) {
    window.electronAPI.setSize(width, height);
  }
}

// ======== 交互系统 ========

/**
 * 初始化拖拽系统
 */
function initDrag(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (!isLoaded) return;

    isDragging = true;
    dragMoved = false;
    dragStartScreen = { x: e.screenX, y: e.screenY };

    // 获取窗口当前位置
    if (window.electronAPI) {
      window.electronAPI.getPosition().then((pos) => {
        dragStartWindow = pos;
      });
    }

    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !window.electronAPI) return;

    // 检测鼠标是否松开（当鼠标移出窗口时，mouseup 事件可能丢失）
    if (e.buttons === 0) {
      isDragging = false;
      canvas.style.cursor = 'default';
      return;
    }

    const dx = e.screenX - dragStartScreen.x;
    const dy = e.screenY - dragStartScreen.y;

    // 超过阈值才认为是拖拽 (区分点击和拖拽)
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMoved = true;
      window.electronAPI.moveWindowBy(dx, dy);
      dragStartScreen = { x: e.screenX, y: e.screenY };
    }
  });

  // 全局 mouseup (防止拖拽到窗口外时状态卡住)
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';

      // 如果没有移动，当作点击处理
      if (!dragMoved && isLoaded && model) {
        handleClick();
      }
    }
  });
}

/**
 * 处理点击模型
 */
function handleClick() {
  if (!model) return;

  // 随机切换表情（50% 概率）
  if (Math.random() < 0.5) {
    const idx = Math.floor(Math.random() * EXPRESSIONS.length);
    const expr = EXPRESSIONS[idx];
    model.expression(expr).catch(() => {});
  }

  // 小概率触发脸红表情
  if (Math.random() < 0.2) {
    setTimeout(() => {
      model.expression('05_LianHong').catch(() => {});
      // 2秒后恢复
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
    if (!isLoaded || !model || isDragging) return;

    // 限制帧率 (30fps 更新眼球位置)
    const now = Date.now();
    if (now - lastFocusTime < 33) return;
    lastFocusTime = now;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // 映射到 -1.5 到 1.5 范围 (让眼睛活动范围稍大)
    const focusX = (x - 0.5) * 3;
    const focusY = (y - 0.5) * 2;

    model.focus(focusX, focusY);
  });

  // 鼠标离开窗口时，眼睛回到中心
  canvas.addEventListener('mouseleave', () => {
    if (model) {
      model.focus(0, 0);
    }
  });
}

// ======== 动画系统 ========

/**
 * 随机表情切换
 */
function startExpressionCycle() {
  const scheduleNext = () => {
    // 25-45 秒随机间隔
    const delay = 25000 + Math.random() * 20000;
    expressionTimer = setTimeout(() => {
      if (!isLoaded || !model) return;

      // 不选当前可能在播放的表情
      const idx = Math.floor(Math.random() * EXPRESSIONS.length);
      model.expression(EXPRESSIONS[idx]).catch(() => {});

      // 记录日志
      console.log('[Ciallo] Expression:', EXPRESSIONS[idx]);

      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

/**
 * 摇头晃脑动画 (微小 idle 动作)
 */
function startIdleAnimation() {
  let tick = 0;

  app.ticker.add(() => {
    if (!isLoaded || !model) return;

    tick += 0.02;

    // 极其微弱的身体摆动 (让模型看起来有生命力)
    if (model.internalModel && model.internalModel.coreModel) {
      try {
        const breath = Math.sin(tick) * 8; // -8 到 8 度
        model.internalModel.coreModel.setParameterValueById(
          'ParamBodyAngleZ',
          breath
        );
        // 参数范围限制
        model.internalModel.coreModel.setParameterValueById(
          'ParamBreath',
          Math.sin(tick * 0.5) * 0.5 + 0.5
        );
      } catch (e) {
        // 忽略参数设置错误
      }
    }
  });
}

// ======== 窗口自适应 ========

/**
 * 窗口大小变化时调整渲染
 */
function initResizeHandler() {
  window.addEventListener('resize', () => {
    if (app) {
      app.renderer.resize(window.innerWidth, window.innerHeight);
    }
    if (model) {
      // 重新计算位置
      const bounds = model.getLocalBounds();
      const scale = model.scale.x;
      model.position.set(
        window.innerWidth / 2,
        window.innerHeight - bounds.height * scale * 0.45
      );
    }
  });
}

// ======== 键盘快捷键 ========

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+T: 切换点击穿透
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      if (window.electronAPI) {
        window.electronAPI.toggleClickThrough();
      }
    }
    // Escape: 切换到中性表情
    if (e.key === 'Escape') {
      if (model) {
        model.expression(NEUTRAL_EXPRESSION).catch(() => {});
      }
    }
    // 数字键 1-8: 直接切换对应表情
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
}

// ======== 启动 ========

async function main() {
  try {
    showCredit();

    // 检查 Cubism Core 是否加载
    if (typeof Live2DCubismCore === 'undefined') {
      showError('Cubism Web Core 未加载。请运行 node scripts/download-cubism-core.js');
      return;
    }

    console.log('[Ciallo] Cubism Core version:', Live2DCubismCore.Version());

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

    // 通知主进程窗口已就绪
    if (window.electronAPI) {
      window.electronAPI.ready();
    }

    console.log('[Ciallo] Ready! Ciallo～(∠?ω< )⌒★!');
  } catch (err) {
    console.error('[Ciallo] Fatal error:', err);
    showError(err.message);
  }
}

// DOM 加载完成后启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
