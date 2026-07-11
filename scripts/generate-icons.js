/**
 * 生成应用图标
 *
 * 生成简单的 PNG 图标用于系统托盘和构建
 * 在 GitHub Actions 上会被替换为正式图标
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUILD_DIR = path.join(__dirname, '..', 'build');

/**
 * 创建最简单的 1x1 PNG (最小有效 PNG)
 * 这里用 Node.js 原生方式生成彩色 PNG 图标
 */
function createPNG(width, height, r, g, b, a = 255) {
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk (image data)
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter byte: None
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;

      if (r === null && g === null && b === null) {
        // 生成渐变彩条
        const hue = (x / width) * 360;
        const sat = 0.8;
        const val = 1.0 - (y / height) * 0.3;
        const [cr, cg, cb] = hsvToRgb(hue, sat, val);
        rawData[offset] = cr;
        rawData[offset + 1] = cg;
        rawData[offset + 2] = cb;
        rawData[offset + 3] = a;
      } else {
        // 边缘像素透明度渐变
        const edgeDist = Math.min(x, y, width - 1 - x, height - 1 - y);
        const edgeAlpha = edgeDist < 2 ? Math.floor((edgeDist + 1) / 3 * a) : a;

        rawData[offset] = r;
        rawData[offset + 1] = g;
        rawData[offset + 2] = b;
        rawData[offset + 3] = edgeAlpha;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc >>>= 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r0, g0, b0;
  if (h < 60) { r0 = c; g0 = x; b0 = 0; }
  else if (h < 120) { r0 = x; g0 = c; b0 = 0; }
  else if (h < 180) { r0 = 0; g0 = c; b0 = x; }
  else if (h < 240) { r0 = 0; g0 = x; b0 = c; }
  else if (h < 300) { r0 = x; g0 = 0; b0 = c; }
  else { r0 = c; g0 = 0; b0 = x; }
  return [
    Math.round((r0 + m) * 255),
    Math.round((g0 + m) * 255),
    Math.round((b0 + m) * 255),
  ];
}

function generateIcons() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  // 生成粉色系图标 (Ciallo 主题色: #FF6699)
  const pinkR = 0xFF, pinkG = 0x66, pinkB = 0x99;

  // 各尺寸图标
  const sizes = {
    'tray-icon.png': 32,
    'icon-16.png': 16,
    'icon-32.png': 32,
    'icon-64.png': 64,
    'icon-128.png': 128,
    'icon-256.png': 256,
  };

  for (const [name, size] of Object.entries(sizes)) {
    // 小图标用纯色，大图标用渐变
    const isSmall = size <= 32;
    const png = createPNG(size, size,
      isSmall ? pinkR : null,
      isSmall ? pinkG : null,
      isSmall ? pinkB : null
    );
    fs.writeFileSync(path.join(BUILD_DIR, name), png);
    console.log(`✓ Created ${name} (${size}x${size})`);
  }

  // 创建 icon.png (256x256, 作为 app 图标)
  const icon256 = createPNG(256, 256, null, null, null);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), icon256);
  console.log('✓ Created icon.png (256x256)');

  // 创建 .ico (Windows 图标) - 使用最简单的格式
  // 把 32x32 PNG 包裹在 ICO 格式中
  createICO(path.join(BUILD_DIR, 'icon.ico'), 32, pinkR, pinkG, pinkB);

  console.log('\n✓ All icons generated!');
}

function createICO(filePath, size, r, g, b) {
  const pngData = createPNG(size, size, r, g, b);
  const pngSize = pngData.length;

  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved (0)
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(1, 4);     // Count: 1 image

  // ICO directory entry
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);  // Width
  entry.writeUInt8(size >= 256 ? 0 : size, 1);  // Height
  entry.writeUInt8(0, 2);  // Colors
  entry.writeUInt8(0, 3);  // Reserved
  entry.writeUInt16LE(1, 4);  // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngSize, 8);  // Image size
  entry.writeUInt32LE(22, 12); // Image offset (header + entry size)

  fs.writeFileSync(filePath, Buffer.concat([header, entry, pngData]));
  console.log(`✓ Created icon.ico (${size}x${size})`);
}

generateIcons();
