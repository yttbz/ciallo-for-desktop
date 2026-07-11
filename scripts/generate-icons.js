/**
 * 生成应用图标
 *
 * 使用下载的丛雨头像作为应用图标
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');

function generateIcons() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  // 使用下载的图标源文件
  const sourceIcon = path.join(BUILD_DIR, 'tray-icon.png');

  if (!fs.existsSync(sourceIcon)) {
    console.error('! 图标源文件不存在，请先下载');
    process.exit(1);
  }

  // 复制到 assets 目录（应用打包时会包含）
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  fs.copyFileSync(sourceIcon, path.join(assetsDir, 'app-icon.png'));
  console.log('✓ Created assets/app-icon.png');

  // 复制为各种尺寸的图标
  const iconNames = [
    'icon-16.png',
    'icon-32.png',
    'icon-64.png',
    'icon-128.png',
    'icon-256.png',
    'icon.png',
  ];

  for (const name of iconNames) {
    const dest = path.join(BUILD_DIR, name);
    fs.copyFileSync(sourceIcon, dest);
    console.log(`✓ Created ${name}`);
  }

  // ICO 文件直接用源图（electron-builder 需要至少 256x256）
  fs.copyFileSync(sourceIcon, path.join(BUILD_DIR, 'icon.ico'));
  console.log('✓ Created icon.ico');

  console.log('\n✓ All icons generated!');
}

generateIcons();
