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
    case 'display': renderDisplay(content); break;
    case 'interaction': renderInteraction(content); break;
    case 'animation': renderAnimation(content); break;
    case 'about': renderAbout(content); break;
  }
}

// ---- 显示 ----

function renderDisplay(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🖼️ 显示设置</div>
      <div class="tab-subtitle">调整丛雨酱的显示效果</div>

      <div class="section">
        <div class="section-title">模型大小</div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">缩放比例</div>
            <div class="row-desc">控制模型在屏幕上的大小</div>
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

      <div class="section">
        <div class="section-title">窗口</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">始终置顶</div>
            <div class="row-desc">让丛雨酱一直显示在最前面</div>
          </div>
          <button class="switch ${currentSettings.alwaysOnTop ? 'on' : ''}" data-key="alwaysOnTop"></button>
        </div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">透明度</div>
            <div class="row-desc">调整窗口透明度</div>
          </div>
          <input type="range" min="30" max="100" value="${Math.round(currentSettings.windowOpacity * 100)}" id="opacitySlider">
          <span class="slider-value" id="opacityValue">${Math.round(currentSettings.windowOpacity * 100)}%</span>
        </div>
      </div>
    </div>
  `;

  // 大小选择
  setupSizePicker();
  // 透明度
  setupOpacitySlider();
  // 开关
  setupSwitches(container);
}

function setupSizePicker() {
  const picker = $('#sizePicker');
  if (!picker) return;

  // 标记当前尺寸
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

// ---- 交互 ----

function renderInteraction(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🖱️ 交互设置</div>
      <div class="tab-subtitle">控制丛雨酱如何与你互动</div>

      <div class="section">
        <div class="section-title">鼠标交互</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">允许拖动</div>
            <div class="row-desc">按住拖拽移动丛雨酱的位置</div>
          </div>
          <button class="switch ${currentSettings.dragEnabled ? 'on' : ''}" data-key="dragEnabled"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">点击反应</div>
            <div class="row-desc">点击丛雨酱时会切换表情</div>
          </div>
          <button class="switch ${currentSettings.clickReaction ? 'on' : ''}" data-key="clickReaction"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">窗口</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">点击穿透</div>
            <div class="row-desc">鼠标事件穿透到下层窗口（不影响其他操作）</div>
          </div>
          <button class="switch ${currentSettings.clickThrough ? 'on' : ''}" data-key="clickThrough"></button>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
}

// ---- 动画 ----

function renderAnimation(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">✨ 动画设置</div>
      <div class="tab-subtitle">控制丛雨酱的动画行为</div>

      <div class="section">
        <div class="section-title">表情与动作</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">自动表情切换</div>
            <div class="row-desc">每隔一段时间自动切换表情</div>
          </div>
          <button class="switch ${currentSettings.expressionCycle ? 'on' : ''}" data-key="expressionCycle"></button>
        </div>
        <div class="slider-row" id="expressionIntervalRow" style="${currentSettings.expressionCycle ? '' : 'opacity: 0.4;'}">
          <div class="row-info">
            <div class="row-label">切换间隔</div>
            <div class="row-desc">自动切换表情的时间间隔</div>
          </div>
          <input type="range" min="10" max="60" value="${currentSettings.expressionInterval}" id="expressionIntervalSlider">
          <span class="slider-value" id="expressionIntervalValue">${currentSettings.expressionInterval}秒</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">追踪</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">鼠标追踪</div>
            <div class="row-desc">眼睛和头部跟随鼠标移动</div>
          </div>
          <button class="switch ${currentSettings.mouseTracking ? 'on' : ''}" data-key="mouseTracking"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Idle 动画</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">待机动作</div>
            <div class="row-desc">模型在待机时微微摆动，看起来更生动</div>
          </div>
          <button class="switch ${currentSettings.idleAnimation ? 'on' : ''}" data-key="idleAnimation"></button>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupExpressionInterval();
}

function setupExpressionInterval() {
  const slider = $('#expressionIntervalSlider');
  const value = $('#expressionIntervalValue');
  const row = $('#expressionIntervalRow');
  if (!slider) return;

  slider.addEventListener('input', () => {
    value.textContent = slider.value + '秒';
  });
  slider.addEventListener('change', () => {
    window.settingsAPI.update('expressionInterval', parseInt(slider.value)).then((res) => {
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
        <div class="about-section-title">⚙️ 设置</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">设置窗口置顶</div>
            <div class="row-desc">让设置面板窗口保持在所有窗口最前面</div>
          </div>
          <button class="switch ${currentSettings.settingsWindowAlwaysOnTop ? 'on' : ''}" data-key="settingsWindowAlwaysOnTop"></button>
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
  renderContent('display');
}

document.addEventListener('DOMContentLoaded', init);
