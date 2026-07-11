/**
 * 下载 Cubism Web Core (从 Live2D 官方 SDK)
 *
 * 从 Live2D 的 SDK ZIP 中提取 Cubism Core JS 文件。
 * 使用 Cubism 4 SDK R4 的纯 JavaScript 实现（不需要 WASM）
 *
 * 支持 Linux (unzip) 和 Windows/CI (Python) 环境
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CORE_DIR = path.join(__dirname, '..', 'cubism-core');
const SDK_URL = 'https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-4-r.4.zip';
const SDK_ZIP_PATH = path.join(CORE_DIR, 'sdk.zip');
const SDK_INNER = 'CubismSdkForWeb-4-r.4';

const FILES = [
  'live2dcubismcore.min.js',
  'live2dcubismcore.d.ts',
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (r) => resolve(r));
        return;
      }
      if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
      else resolve(res);
    }).on('error', reject);
  });
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function main() {
  console.log('=== 下载 Cubism Web Core (SDK R4) ===\n');

  if (!fs.existsSync(CORE_DIR)) fs.mkdirSync(CORE_DIR, { recursive: true });

  // 检查是否已有文件
  if (FILES.every((f) => fs.existsSync(path.join(CORE_DIR, f)))) {
    console.log('✓ Core files already exist, skipping');
    return;
  }

  // 下载
  if (!fs.existsSync(SDK_ZIP_PATH)) {
    console.log(`Downloading SDK...`);
    const res = await fetch(SDK_URL);
    const data = await collectStream(res);
    fs.writeFileSync(SDK_ZIP_PATH, data);
    console.log(`  Downloaded ${data.length} bytes`);
  }

  const isWin = process.platform === 'win32';
  let success = false;

  if (isWin) {
    // Windows: 用 Python
    const pyScript = `
import zipfile, os, sys
z = zipfile.ZipFile(r'${SDK_ZIP_PATH}', 'r')
out = r'${CORE_DIR}'
for f in ${JSON.stringify(FILES)}:
    data = z.read('${SDK_INNER}/Core/' + f)
    with open(os.path.join(out, f), 'wb') as fp:
        fp.write(data)
    print(f'Extracted {f}', len(data))
`;
    for (const py of ['python3', 'python', 'py']) {
      const r = run(py, ['-c', pyScript]);
      if (r.code === 0) { success = true; console.log(r.stdout); break; }
    }
  } else {
    // Linux/macOS: 用 unzip
    for (const file of FILES) {
      const r = run('unzip', ['-o', SDK_ZIP_PATH, `${SDK_INNER}/Core/${file}`, '-d', CORE_DIR]);
      if (r.code === 0) {
        const src = path.join(CORE_DIR, SDK_INNER, 'Core', file);
        const dst = path.join(CORE_DIR, file);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
          console.log(`✓ Extracted ${file} (${fs.statSync(dst).size} bytes)`);
          success = true;
        }
      }
    }

    // 清理 unzip 产生的目录结构
    const sdkDir = path.join(CORE_DIR, SDK_INNER);
    if (fs.existsSync(sdkDir)) {
      fs.rmSync(sdkDir, { recursive: true, force: true });
    }
  }

  // 清理 SDK ZIP
  try { fs.unlinkSync(SDK_ZIP_PATH); } catch (e) {}

  if (!success) {
    console.error('\n✗ Failed! Please manually download CubismSdkForWeb-4-r.4.zip');
    console.error('  and extract Core/ to cubism-core/');
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ Cubism Web Core is ready!');
}

main().catch((err) => { console.error('Fatal:', err.message); process.exitCode = 1; });
