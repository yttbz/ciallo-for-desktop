/**
 * CialloForDesktop - 通知音效
 *
 * 使用 Web Audio API 合成" Ciallo～"风格的提示音。
 * 不需要外部音频文件，直接生成可爱提示音。
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * 播放" Ciallo～"风格提示音
 * 两个上升音符 + 明亮音色
 */
function playCialloChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // 第一个音符 (C#5 - 554Hz) "Ci-a"
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(554, now);
    osc1.frequency.exponentialRampToValueAtTime(740, now + 0.12);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // 第二个音符 (E5 - 659Hz) "～llo"
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659, now + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(880, now + 0.22);
    gain2.gain.setValueAtTime(0.25, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);

    // 泛音层 - 让声音更明亮
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1108, now); // 2倍频
    gain3.gain.setValueAtTime(0.08, now);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now);
    osc3.stop(now + 0.3);
  } catch (e) {
    console.warn('[Sound] Failed to play chime:', e.message);
  }
}

/**
 * 播放通知提示音（较短的版本）
 */
function playNotification() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  } catch (_) {}
}

/**
 * 播放完成提示音
 */
function playComplete() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    // 三个上升音符
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.1;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } catch (_) {}
}

export { playCialloChime, playNotification, playComplete };
