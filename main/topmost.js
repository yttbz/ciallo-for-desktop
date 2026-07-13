/**
 * CialloForDesktop - 置顶管理
 *
 * 确保宠物窗口始终保持在最上层，处理各种可能丢失置顶状态的场景。
 * 从 clawd-on-desk 的 topmost-runtime.js 借鉴思路。
 *
 * Windows 使用 'pop-up-menu' 级别（高于普通置顶窗口）
 * 含 5 秒看门狗定时恢复
 */

const { screen } = require('electron');

const WATCHDOG_INTERVAL = 5000; // 每 5 秒看门狗恢复置顶

/**
 * 创建置顶管理器
 * @param {() => BrowserWindow} getWindow - 获取主窗口的函数
 * @param {() => boolean} isEnabled - 返回当前是否启用了置顶
 */
function createTopmostManager(getWindow, isEnabled) {
  let reassertTimer = null;
  let watchdogTimer = null;

  /**
   * 重新断言置顶状态
   * Windows 上使用 'pop-up-menu' 级别，高于普通窗口
   */
  function reassert() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (!isEnabled()) return;
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu');
    } catch (e) {
      win.setAlwaysOnTop(true);
    }
  }

  /** 带防抖的安全恢复 */
  function safeReassert() {
    if (reassertTimer) clearTimeout(reassertTimer);
    reassertTimer = setTimeout(reassert, 50);
  }

  /** 启动置顶监控 + 看门狗 */
  function start() {
    screen.on('display-added', safeReassert);
    screen.on('display-removed', safeReassert);
    screen.on('display-metrics-changed', safeReassert);
    watchdogTimer = setInterval(reassert, WATCHDOG_INTERVAL);
    reassert();
  }

  /** 停止置顶监控 */
  function stop() {
    screen.removeListener('display-added', safeReassert);
    screen.removeListener('display-removed', safeReassert);
    screen.removeListener('display-metrics-changed', safeReassert);
    if (reassertTimer) { clearTimeout(reassertTimer); reassertTimer = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  return { reassert, safeReassert, start, stop };
}

module.exports = { createTopmostManager };
