/**
 * CialloForDesktop - Preload 脚本
 *
 * 通过 contextBridge 安全地暴露 Electron API 给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  moveWindowBy: (dx, dy) => ipcRenderer.send('window-move-by', { dx, dy }),
  setPosition: (x, y) => ipcRenderer.send('window-set-position', { x, y }),
  getPosition: () => ipcRenderer.invoke('window-get-position'),
  setSize: (width, height) => ipcRenderer.send('window-set-size', { width, height }),
  getSize: () => ipcRenderer.invoke('window-get-size'),

  // 屏幕信息
  getScreenInfo: () => ipcRenderer.invoke('screen-get-info'),

  // 点击穿透
  toggleClickThrough: () => ipcRenderer.send('toggle-click-through'),
  isClickThrough: () => ipcRenderer.invoke('is-click-through'),

  // 窗口就绪通知
  ready: () => ipcRenderer.send('window-ready'),

  // 打开设置窗口
  openSettings: () => ipcRenderer.send('open-settings'),

  // 显示右键上下文菜单
  showContextMenu: () => ipcRenderer.send('show-context-menu'),

  // 设置管理 (主窗口也监听设置变更，但不想写，不主动暴露写权限)
  onSettingsChanged: (cb) => {
    const handler = (_event, settings) => cb(settings);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  // 获取设置值
  getSettings: () => ipcRenderer.invoke('settings:get'),
});
