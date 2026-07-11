/**
 * 生成应用图标
 *
 * 使用下载的丛雨头像作为应用图标
 * 生成有效的 ICO 文件（PNG 封装为 ICO）
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

/**
 * 将 PNG 数据封装为 ICO 文件格式
 * ICO = 6字节头 + 16字节目录项 + PNG数据
 */
function createICO(pngBuffer) {
  const count = 1;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + count * entrySize;

  // Header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type: ICO
  header.writeUInt16LE(count, 4);  // Image count

  // Directory entry for 256x256
  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(0, 0);          // Width (0 = 256)
  entry.writeUInt8(0, 1);          // Height (0 = 256)
  entry.writeUInt8(0, 2);          // Colors
  entry.writeUInt8(0, 3);          // Reserved
  entry.writeUInt16LE(1, 4);       // Color planes
  entry.writeUInt16LE(32, 6);      // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);   // Image size
  entry.writeUInt32LE(dataOffset, 12);        // Offset to image data

  return Buffer.concat([header, entry, pngBuffer]);
}

function generateIcons() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // 使用下载的图标源文件
  const sourceIcon = path.join(BUILD_DIR, 'tray-icon.png');

  if (!fs.existsSync(sourceIcon)) {
    console.error('! 图标源文件不存在，请先下载');
    console.error('  运行: curl -sL -o build/tray-icon.png <图标URL>');
    process.exit(1);
  }

  const pngData = fs.readFileSync(sourceIcon);

  // 复制到 assets 目录（应用打包时会包含）
  fs.copyFileSync(sourceIcon, path.join(ASSETS_DIR, 'app-icon.png'));
  console.log('✓ Created assets/app-icon.png');

  // 复制为各种尺寸的 PNG 图标
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

  // 生成真正的 ICO 文件（将 PNG 封装在 ICO 容器中）
  const icoData = createICO(pngData);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoData);
  console.log(`✓ Created icon.ico (${icoData.length} bytes)`);

  console.log('\n✓ All icons generated!');
}

generateIcons();
