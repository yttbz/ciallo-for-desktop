/**
 * CialloForDesktop - 设置面板渲染器
 *
 * 设置面板的 UI 渲染和交互逻辑
 */

// ======== 全局状态 ========

let currentSettings = null;
let appVersion = '1.0.0'; // fallback

// ======== DOM 引用 ========

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ======== 工具函数 ========

function showToast(message, isError = false) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    padding: 10px 20px; border-radius: 8px; font-size: 13px; z-index: 100;
    background: ${isError ? '#ff6b6b' : 'var(--pink)'}; color: white;
    box-shadow: 0 2px 10px rgba(255,100,150,0.3); transition: opacity 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
}

// ======== Tab 导航 ========

function switchTab(tabId) {
  $$('.sidebar-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  renderContent(tabId);
}

// ======== 渲染各 Tab ========

function renderContent(tabId) {
  const content = $('#content');
  switch (tabId) {
    case 'window': renderWindow(content); break;
    case 'size': renderSize(content); break;
    case 'hud': renderHud(content); break;
    case 'tray': renderTray(content); break;
    case 'about': renderAbout(content); break;
  }
}

// ---- 📌 置顶/窗口 ----

function renderWindow(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📌 窗口设置</div>
      <div class="tab-subtitle">控制丛雨酱窗口的显示行为</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">始终置顶</div>
            <div class="row-desc">让丛雨酱一直显示在所有窗口最前面</div>
          </div>
          <button class="switch ${currentSettings.alwaysOnTop ? 'on' : ''}" data-key="alwaysOnTop"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">点击穿透</div>
            <div class="row-desc">鼠标事件穿透到下层窗口</div>
          </div>
          <button class="switch ${currentSettings.clickThrough ? 'on' : ''}" data-key="clickThrough"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">透明度</div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">窗口透明度</div>
            <div class="row-desc">调整窗口不透明度 (100% = 不透明)</div>
          </div>
          <input type="range" min="30" max="100" value="${Math.round(currentSettings.windowOpacity * 100)}" id="opacitySlider">
          <span class="slider-value" id="opacityValue">${Math.round(currentSettings.windowOpacity * 100)}%</span>
        </div>
      </div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">设置窗口置顶</div>
            <div class="row-desc">让设置面板窗口保持在所有窗口最前面</div>
          </div>
          <button class="switch ${currentSettings.settingsWindowAlwaysOnTop ? 'on' : ''}" data-key="settingsWindowAlwaysOnTop"></button>
        </div>
      </div>
    </div>
  `;

  setupOpacitySlider();
  setupSwitches(container);
}

function setupOpacitySlider() {
  const slider = $('#opacitySlider');
  const value = $('#opacityValue');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value);
    value.textContent = val + '%';
  });
  slider.addEventListener('change', () => {
    const val = parseInt(slider.value) / 100;
    window.settingsAPI.update('windowOpacity', val).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- 📏 大小 ----

function renderSize(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📏 大小设置</div>
      <div class="tab-subtitle">调整丛雨酱在屏幕上的显示大小</div>

      <div class="section">
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">模型缩放</div>
            <div class="row-desc">选择预设尺寸快速调整丛雨酱的大小</div>
          </div>
          <div class="size-picker" id="sizePicker">
            <button class="size-btn" data-scale="0.5">S</button>
            <button class="size-btn" data-scale="0.75">M</button>
            <button class="size-btn active" data-scale="0.85">L</button>
            <button class="size-btn" data-scale="1.15">XL</button>
            <button class="size-btn" data-scale="1.5">XXL</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSizePicker();
}

function setupSizePicker() {
  const picker = $('#sizePicker');
  if (!picker) return;

  const currentScale = currentSettings.modelScale;
  picker.querySelectorAll('.size-btn').forEach((btn) => {
    const scale = parseFloat(btn.dataset.scale);
    btn.classList.toggle('active', Math.abs(scale - currentScale) < 0.05);
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.settingsAPI.update('modelScale', scale).then((res) => {
        if (!res.success) showToast('保存失败: ' + (res.error || ''), true);
      });
    });
  });
}

// ---- 📊 HUD ----

function renderHud(container) {
  const positionOptions = [
    { value: 'top-left', label: '左上' },
    { value: 'top-right', label: '右上' },
    { value: 'bottom-left', label: '左下' },
    { value: 'bottom-right', label: '右下' },
  ];

  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📊 HUD 设置</div>
      <div class="tab-subtitle">屏幕信息叠加层显示设置</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">启用 HUD</div>
            <div class="row-desc">在模型窗口上显示信息面板</div>
          </div>
          <button class="switch ${currentSettings.enableHUD ? 'on' : ''}" data-key="enableHUD"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">显示内容</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示时钟</div>
            <div class="row-desc">显示当前时间</div>
          </div>
          <button class="switch ${currentSettings.hudShowClock ? 'on' : ''}" data-key="hudShowClock"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示表情名称</div>
            <div class="row-desc">显示当前表情名称</div>
          </div>
          <button class="switch ${currentSettings.hudShowExpressionName ? 'on' : ''}" data-key="hudShowExpressionName"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示状态指示</div>
            <div class="row-desc">显示点击穿透、鼠标追踪等状态</div>
          </div>
          <button class="switch ${currentSettings.hudShowStatusIndicators ? 'on' : ''}" data-key="hudShowStatusIndicators"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">随机问候语</div>
            <div class="row-desc">HUD 中每隔一段时间显示随机问候</div>
          </div>
          <button class="switch ${currentSettings.hudShowGreetings ? 'on' : ''}" data-key="hudShowGreetings"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">外观</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">HUD 位置</div>
            <div class="row-desc">信息面板在窗口中的位置</div>
          </div>
          <select class="dropdown" id="hudPosition">
            ${positionOptions.map(opt =>
              `<option value="${opt.value}" ${currentSettings.hudPosition === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">HUD 透明度</div>
            <div class="row-desc">调整 HUD 面板的透明度</div>
          </div>
          <input type="range" min="30" max="100" value="${Math.round(currentSettings.hudOpacity * 100)}" id="hudOpacitySlider">
          <span class="slider-value slider-value-wide" id="hudOpacityValue">${Math.round(currentSettings.hudOpacity * 100)}%</span>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupHudOpacitySlider();
  setupHudPositionDropdown();
}

function setupHudOpacitySlider() {
  const slider = $('#hudOpacitySlider');
  const value = $('#hudOpacityValue');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value);
    value.textContent = val + '%';
  });
  slider.addEventListener('change', () => {
    const val = parseInt(slider.value) / 100;
    window.settingsAPI.update('hudOpacity', val).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

function setupHudPositionDropdown() {
  const select = $('#hudPosition');
  if (!select) return;
  select.addEventListener('change', () => {
    window.settingsAPI.update('hudPosition', select.value).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- 🧩 系统托盘 ----

function renderTray(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🧩 系统托盘设置</div>
      <div class="tab-subtitle">控制系统托盘图标和窗口关闭行为</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示托盘图标</div>
            <div class="row-desc">在系统托盘中显示应用图标</div>
          </div>
          <button class="switch ${currentSettings.showTrayIcon !== false ? 'on' : ''}" data-key="showTrayIcon"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">最小化到系统托盘</div>
            <div class="row-desc">关闭窗口时将应用隐藏到系统托盘而不是退出</div>
          </div>
          <button class="switch ${currentSettings.minimizeToTray ? 'on' : ''}" data-key="minimizeToTray"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">关闭按钮操作</div>
            <div class="row-desc">点击关闭时执行的操作</div>
          </div>
          <select class="dropdown" id="closeAction">
            <option value="minimize-to-tray" ${currentSettings.closeButtonAction === 'minimize-to-tray' ? 'selected' : ''}>最小化到托盘</option>
            <option value="quit" ${currentSettings.closeButtonAction === 'quit' ? 'selected' : ''}>退出程序</option>
          </select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">启动</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">开机自启</div>
            <div class="row-desc">系统启动时自动运行 CialloForDesktop</div>
          </div>
          <button class="switch ${currentSettings.autoStart ? 'on' : ''}" data-key="autoStart"></button>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupCloseActionDropdown();
}

function setupCloseActionDropdown() {
  const select = $('#closeAction');
  if (!select) return;
  select.addEventListener('change', () => {
    window.settingsAPI.update('closeButtonAction', select.value).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- 关于 ----

function renderAbout(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="about-header">
        <div class="about-title">Ciallo～(∠?ω< )⌒★!</div>
        <div class="about-version">v${appVersion}</div>
        <div class="about-model">一款基于 Live2D 的桌面宠物</div>
      </div>

      <div class="about-section">
        <div class="about-section-title">💝 感谢使用</div>
        <div class="about-credit">
          模型: <strong>浴衣丛雨 (Murasame Yukata)</strong><br>
          版权: <strong>© ゆずソフト (Yuzu-Soft)</strong><br>
          仅供个人使用，请勿用于直播或商业用途<br>
          <br>
          <span class="about-link" id="officialSiteLink" style="font-size:13px;">
            🌐 官方网站 · m1f.cn →
          </span>
          <br>
          <span class="about-link" id="githubLink" style="font-size:13px;">
            📂 源代码 · GitHub →
          </span>
        </div>
      </div>

      <div class="about-section">
        <div class="about-section-title">🛠️ 技术栈</div>
        <div class="about-credit">
          Electron · PixiJS · Live2D Cubism 4<br>
          pixi-live2d-display · electron-builder
        </div>
      </div>

      <div class="about-section">
        <div class="about-section-title">⌨️ 快捷键</div>
        <div class="about-credit">
          <strong>Ctrl+T</strong> — 切换点击穿透<br>
          <strong>Esc</strong> — 重置表情<br>
          <strong>1-8</strong> — 直接切换对应表情
        </div>
      </div>

      <div class="footer-actions">
        <button class="btn" id="resetBtn">重置所有设置</button>
      </div>
    </div>
  `;

  // m1f.cn 官网链接
  document.getElementById('officialSiteLink').addEventListener('click', () => {
    window.settingsAPI.openExternal('https://m1f.cn');
  });

  // GitHub 链接
  document.getElementById('githubLink').addEventListener('click', () => {
    window.settingsAPI.openExternal('https://github.com/yttbz/ciallo-for-desktop');
  });

  // 重置按钮
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const result = await window.settingsAPI.reset();
    if (result.success) {
      showToast('已重置为默认设置');
    } else {
      showToast('重置失败', true);
    }
  });

  // 设置窗口置顶开关
  setupSwitches(container);
}

// ======== 通用开关组件 ========

function setupSwitches(container) {
  container.querySelectorAll('.switch').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const key = sw.dataset.key;
      const newState = !sw.classList.contains('on');

      // 即时视觉反馈
      sw.classList.toggle('on');

      const result = await window.settingsAPI.update(key, newState);
      if (!result.success) {
        // 失败回滚
        sw.classList.toggle('on');
        showToast('保存失败', true);
      }

      // 表情切换间隔的特殊处理
      if (key === 'expressionCycle') {
        const row = document.getElementById('expressionIntervalRow');
        if (row) {
          row.style.opacity = newState ? '1' : '0.4';
        }
      }
    });
  });
}

// ======== 设置变更监听 ========

function onSettingsChanged(settings) {
  currentSettings = settings;
  const activeTab = document.querySelector('.sidebar-item.active');
  if (activeTab) {
    renderContent(activeTab.dataset.tab);
  }
}

// ======== 启动 ========

async function init() {
  // 获取初始设置
  currentSettings = await window.settingsAPI.getSettings();

  // 获取应用版本号
  try {
    if (window.settingsAPI.getAppVersion) {
      appVersion = await window.settingsAPI.getAppVersion();
    }
  } catch (e) {
    console.warn('[Settings] Failed to get app version:', e.message);
  }

  // 监听变更
  window.settingsAPI.onChanged(onSettingsChanged);

  // 标签页切换
  $$('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
    });
  });

  // 渲染默认 Tab
  renderContent('window');
}

document.addEventListener('DOMContentLoaded', init);
