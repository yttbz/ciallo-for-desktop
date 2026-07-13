/**
 * CialloForDesktop - Dashboard 窗口管理
 *
 * 创建和管理 Claude Code 会话监控仪表盘窗口。
 * 使用工厂模式，接收上下文对象 { getPetWindow, getSnapshot, getI18n, log }。
 *
 * 用法:
 *   const dashboard = initDashboard({
 *     getPetWindow: () => mainWindow,
 *     getSnapshot:  () => stateManager.getSnapshot(),
 *     getI18n:      () => ({ locale: 'zh' }),
 *     log:          (msg) => console.log(msg),
 *   });
 *   dashboard.openDashboard();
 *   dashboard.broadcastSnapshot(); // 每次状态变化时调用
 */

const { BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');

// ======== 模块级状态 ========

/** @type {BrowserWindow|null} */
let dashboardWindow = null;

/** @type {object|null} */
let dashboardCtx = null;

/** 防止重复注册 IPC 处理器 */
let ipcHandlersRegistered = false;

// ======== IPC 处理器注册 ========

/**
 * 注册所有 Dashboard 相关的 IPC 处理器。
 * 全局只执行一次，防止 initDashboard 多次调用时重复注册。
 */
function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  // ── 获取快照 ──────────────────────────────────────────
  ipcMain.handle('dashboard:get-snapshot', () => {
    if (!dashboardCtx || typeof dashboardCtx.getSnapshot !== 'function') {
      return {
        sessions: {},
        orderedIds: [],
        groups: {},
        sessionCount: 0,
        petState: 'idle',
      };
    }
    const snap = dashboardCtx.getSnapshot();
    return snap;
  });

  // ── 获取国际化资源 ──────────────────────────────────
  ipcMain.handle('dashboard:get-i18n', () => {
    if (!dashboardCtx) return null;
    return typeof dashboardCtx.getI18n === 'function'
      ? dashboardCtx.getI18n()
      : null;
  });

  // ── 聚焦会话（跳转到终端） ──────────────────────────
  ipcMain.on('dashboard:focus-session', (_event, sessionId) => {
    if (dashboardCtx && typeof dashboardCtx.log === 'function') {
      dashboardCtx.log(`[Dashboard] Focus session: ${sessionId}`);
    }
    // TODO: 在终端中聚焦该会话（需要终端窗口集成）
  });

  // ── 隐藏/关闭会话 ──────────────────────────────────
  ipcMain.handle('dashboard:hide-session', (_event, sessionId) => {
    if (dashboardCtx && typeof dashboardCtx.log === 'function') {
      dashboardCtx.log(`[Dashboard] Hide session: ${sessionId}`);
    }
    // TODO: 标记会话为已隐藏或从状态机中移除
    return { success: true };
  });

  // ── 设置会话别名 ──────────────────────────────────
  ipcMain.handle('dashboard:set-session-alias', (_event, { sessionId, alias }) => {
    if (dashboardCtx && typeof dashboardCtx.log === 'function') {
      dashboardCtx.log(`[Dashboard] Set alias for ${sessionId}: ${alias}`);
    }
    // TODO: 将会话别名存到持久化存储中
    return { success: true };
  });

  // ── 确认会话完成 ──────────────────────────────────
  ipcMain.handle('session:ack-completion', (_event, sessionId) => {
    if (dashboardCtx && typeof dashboardCtx.log === 'function') {
      dashboardCtx.log(`[Dashboard] Acknowledge completion: ${sessionId}`);
    }
    // TODO: 调用状态机的 ackCompletion 方法
    return { success: true };
  });
}

// ======== 窗口管理 ========

/**
 * 初始化 Dashboard 工厂。
 *
 * @param {object} ctx - 上下文对象
 * @param {Function} ctx.getPetWindow - () => BrowserWindow, 获取主宠物窗口
 * @param {Function} ctx.getSnapshot  - () => object, 获取状态快照
 * @param {Function} [ctx.getI18n]    - () => object|null, 获取国际化资源
 * @param {Function} ctx.log          - (msg: string) => void, 日志输出
 * @returns {{ openDashboard: Function, closeDashboard: Function, broadcastSnapshot: Function }}
 */
function initDashboard(ctx) {
  dashboardCtx = ctx;
  registerIpcHandlers();

  // ─── 打开 / 聚焦 Dashboard ───────────────────────────

  function openDashboard() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.focus();
      return;
    }

    const isDark = nativeTheme.shouldUseDarkColors;

    dashboardWindow = new BrowserWindow({
      width: 480,
      height: 600,
      minWidth: 320,
      minHeight: 400,
      resizable: true,
      show: false,
      backgroundColor: isDark ? '#1c1c1f' : '#f5f5f7',
      title: 'CialloForDesktop - Claude Code Dashboard',
      webPreferences: {
        preload: path.join(__dirname, 'preload-dashboard.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    dashboardWindow.loadFile(path.join(__dirname, '..', 'src', 'dashboard.html'));

    // 居中于宠物窗口
    centerOnPetWindow();

    dashboardWindow.once('ready-to-show', () => {
      dashboardWindow.show();
      broadcastSnapshot();
    });

    dashboardWindow.on('closed', () => {
      dashboardWindow = null;
    });

    // 监听系统主题变化 → 更新窗口背景色
    const onThemeUpdated = () => {
      if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        const dark = nativeTheme.shouldUseDarkColors;
        dashboardWindow.setBackgroundColor(dark ? '#1c1c1f' : '#f5f5f7');
      }
    };
    nativeTheme.on('updated', onThemeUpdated);
    dashboardWindow.on('closed', () => {
      nativeTheme.removeListener('updated', onThemeUpdated);
      dashboardWindow = null;
    });
  }

  // ─── 关闭 Dashboard ─────────────────────────────────

  function closeDashboard() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close();
    }
  }

  // ─── 广播快照到 Dashboard ───────────────────────────

  /**
   * 发送会话快照到 Dashboard 渲染进程。
   * 每次状态变化后调用此函数以更新 UI。
   *
   * @param {object} [snapshot] - 可选，省略则通过 ctx.getSnapshot() 获取
   */
  function broadcastSnapshot(snapshot) {
    const data = snapshot || (typeof ctx.getSnapshot === 'function' ? ctx.getSnapshot() : null);
    if (data && dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send('dashboard:session-snapshot', data);
    }
  }

  // ─── 居中于宠物窗口 ─────────────────────────────────

  function centerOnPetWindow() {
    try {
      const petWindow =
        typeof ctx.getPetWindow === 'function' ? ctx.getPetWindow() : null;
      if (petWindow && !petWindow.isDestroyed()) {
        const [petX, petY] = petWindow.getPosition();
        const [petW, petH] = petWindow.getSize();
        const [winW, winH] = dashboardWindow.getSize();
        dashboardWindow.setPosition(
          Math.round(petX + (petW - winW) / 2),
          Math.round(petY + (petH - winH) / 2)
        );
      }
    } catch (_) {
      // 忽略定位错误，保留默认位置
    }
  }

  return {
    openDashboard,
    closeDashboard,
    broadcastSnapshot,
  };
}

module.exports = { initDashboard };
