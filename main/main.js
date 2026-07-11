/**
 * CialloForDesktop - Electron 主进程
 *
 * 管理透明窗口、系统托盘、IPC 通信
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  dialog,
} = require('electron');
const path = require('path');

// ======== 全局状态 ========
let mainWindow = null;
let tray = null;
let isClickThrough = false;
let isQuitting = false;
const WINDOW_WIDTH = 540;
const WINDOW_HEIGHT = 720;

// ======== 单实例锁 ========
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ======== 窗口管理 ========

function createWindow() {
  // 获取当前显示器的工作区域
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: Math.round((screenWidth - WINDOW_WIDTH) / 2),
    y: Math.round((screenHeight - WINDOW_HEIGHT) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    enableLargerThanScreen: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // 加载页面
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // 窗口准备好后再显示（避免白屏闪烁）
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 点击透明区域穿透
  mainWindow.setIgnoreMouseEvents(false);

  // 调试：开发模式下打开 DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ======== 系统托盘 ========

function createTray() {
  // 使用 16x16 或 32x32 图标
  const iconPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    // 缩放到合适大小
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch (e) {
    // 如果图标文件不存在，创建一个简单的纯色图标
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Ciallo～(∠?ω< )⌒★!');

  updateTrayMenu();
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ciallo～(∠?ω< )⌒★!',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '显示/隐藏',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: `点击穿透: ${isClickThrough ? '开' : '关'}`,
      type: 'checkbox',
      checked: isClickThrough,
      click: (menuItem) => {
        toggleClickThrough(menuItem.checked);
      },
    },
    { type: 'separator' },
    {
      label: '关于',
      click: showAboutDialog,
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ======== 点击穿透切换 ========

function toggleClickThrough(enable) {
  isClickThrough = enable;
  if (mainWindow) {
    if (enable) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  }
  updateTrayMenu();
}

// ======== 关于对话框 ========

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 CialloForDesktop',
    message: 'Ciallo～(∠?ω< )⌒★!',
    detail: [
      'CialloForDesktop v1.0.0',
      '',
      '一款基于 Live2D 的桌面宠物',
      '模型: 浴衣丛雨 (Murasame Yukata)',
      '版权: © ゆずソフト (Yuzu-Soft)',
      '仅供个人使用',
      '',
      'Built with Electron + PixiJS + Live2D Cubism',
    ].join('\n'),
  });
}

// ======== IPC 处理器 ========

// 移动窗口（拖拽用）
ipcMain.on('window-move-by', (event, { dx, dy }) => {
  if (!mainWindow || isClickThrough) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

// 设置窗口位置
ipcMain.on('window-set-position', (event, { x, y }) => {
  if (!mainWindow) return;
  mainWindow.setPosition(x, y);
});

// 获取窗口位置
ipcMain.handle('window-get-position', () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

// 设置窗口大小
ipcMain.on('window-set-size', (event, { width, height }) => {
  if (!mainWindow) return;
  mainWindow.setSize(
    Math.max(100, Math.min(width, 800)),
    Math.max(100, Math.min(height, 1000))
  );
});

// 获取窗口大小
ipcMain.handle('window-get-size', () => {
  if (!mainWindow) return { width: 0, height: 0 };
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

// 获取屏幕信息
ipcMain.handle('screen-get-info', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return {
    screenWidth: width,
    screenHeight: height,
  };
});

// 切换点击穿透
ipcMain.on('toggle-click-through', () => {
  toggleClickThrough(!isClickThrough);
});

// 检查是否点击穿透模式
ipcMain.handle('is-click-through', () => {
  return isClickThrough;
});

// 窗口就绪通知
ipcMain.on('window-ready', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

// ======== 应用生命周期 ========

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
