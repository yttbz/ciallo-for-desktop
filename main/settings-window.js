/**
 * CialloForDesktop - 设置窗口管理
 *
 * 创建和管理设置窗口
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let settingsWindow = null;

function createSettingsWindow(parentWindow, windowSettings = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: parentWindow,
    modal: true,
    frame: true,
    title: 'CialloForDesktop 设置',
    backgroundColor: '#fff5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'src', 'settings.html'));

  // 应用设置窗口置顶
  if (windowSettings.settingsWindowAlwaysOnTop) {
    settingsWindow.setAlwaysOnTop(true);
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // 阻止窗口被关闭后还引用，同时恢复父窗口置顶
  settingsWindow.on('close', () => {
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.focus();
      // 某些 Windows 版本在模态对话框关闭后会丢掉父窗口置顶
      if (windowSettings.alwaysOnTop) {
        try {
          parentWindow.setAlwaysOnTop(true, 'pop-up-menu');
        } catch (_) {
          parentWindow.setAlwaysOnTop(true);
        }
      }
    }
  });
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
}

function getSettingsWindow() {
  return settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;
}

module.exports = { createSettingsWindow, closeSettingsWindow, getSettingsWindow };
