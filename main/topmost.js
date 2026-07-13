/**
 * CialloForDesktop - 置顶管理
 *
 * 确保宠物窗口始终保持在最上层，处理各种可能丢失置顶状态的场景。
 * 从 clawd-on-desk 的 topmost-runtime.js 借鉴思路。
 */

const { screen } = require('electron');

/**
 * 创建置顶管理器
 * @param {() => BrowserWindow} getWindow - 获取主窗口的函数
 * @param {() => boolean} isEnabled - 返回当前是否启用了置顶
 */
function createTopmostManager(getWindow, isEnabled) {
  let reassertTimer = null;

  /**
   * 重新断言置顶状态 - 核心函数
   * 使用 'screen-saver' 级别获得最高优先级，然后回退到 'normal'
   */
  function reassert() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (!isEnabled()) return;

    // 两步法确保置顶：
    // 1. 先设置最高级别 'screen-saver'（可覆盖全屏窗口）
    // 2. 再回退到 'normal' 级别（正常置顶）
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setAlwaysOnTop(true, 'normal');
    } catch (e) {
      // fallback: 直接设置 boolean
      win.setAlwaysOnTop(true);
    }
  }

  /**
   * 安全地恢复置顶（带防抖）
   */
  function safeReassert() {
    if (reassertTimer) clearTimeout(reassertTimer);
    reassertTimer = setTimeout(reassert, 50);
  }

  /**
   * 启动置顶监控
   */
  function start() {
    // 监听显示器变更（外接/断开显示器时可能丢失置顶）
    screen.on('display-added', safeReassert);
    screen.on('display-removed', safeReassert);
    screen.on('display-metrics-changed', safeReassert);

    // 立即执行一次
    reassert();
  }

  /**
   * 停止置顶监控
   */
  function stop() {
    screen.removeListener('display-added', safeReassert);
    screen.removeListener('display-removed', safeReassert);
    screen.removeListener('display-metrics-changed', safeReassert);
    if (reassertTimer) {
      clearTimeout(reassertTimer);
      reassertTimer = null;
    }
  }

  return { reassert, safeReassert, start, stop };
}

module.exports = { createTopmostManager };
