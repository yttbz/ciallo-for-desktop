/**
 * 生成应用图标
 *
 * 生成 PNG 图标和 ICO 文件
 * ICO 使用 256x256 PNG（electron-builder 要求至少 256x256）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUILD_DIR = path.join(__dirname, '..', 'build');

function createPNGBuffer(width, height, r, g, b, a = 255) {
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
        // 生成渐变彩条 (用于大图标)
        const hue = (x / width) * 360;
        const sat = 0.8;
        const val = 1.0 - (y / height) * 0.3;
        const [cr, cg, cb] = hsvToRgb(hue, sat, val);
        rawData[offset] = cr;
        rawData[offset + 1] = cg;
        rawData[offset + 2] = cb;
        rawData[offset + 3] = a;
      } else {
        // 纯色 + 边缘透明度渐变
        const edgeDist = Math.min(x, y, width - 1 - x, height - 1 - y);
        const edgeAlpha = edgeDist < Math.max(2, Math.floor(width * 0.02))
          ? Math.floor((edgeDist + 1) / Math.max(2, Math.floor(width * 0.02)) * a)
          : a;

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

/**
 * 创建 ICO 文件
 * ICO = header + directory entries + image data (PNG)
 * 包含 32x32 和 256x256 两个尺寸
 */
function createICO(images) {
  const count = images.length;
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(count, 4); // Count

  // Calculate offsets
  let dataOffset = headerSize + count * entrySize;
  const buffers = [];

  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    const w = img.width >= 256 ? 0 : img.width;
    const h = img.height >= 256 ? 0 : img.height;
    entry.writeUInt8(w, 0);    // Width
    entry.writeUInt8(h, 1);    // Height
    entry.writeUInt8(0, 2);    // Colors
    entry.writeUInt8(0, 3);    // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(img.data.length, 8);  // Image size
    entry.writeUInt32LE(dataOffset, 12);       // Offset

    buffers.push(entry);
    dataOffset += img.data.length;
  }

  return Buffer.concat([header, ...buffers, ...images.map(i => i.data)]);
}

function generateIcons() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  const pinkR = 0xFF, pinkG = 0x66, pinkB = 0x99; // Ciallo 粉色

  // 小图标: 纯色
  const smallSizes = {
    'tray-icon.png': 32,
    'icon-16.png': 16,
    'icon-32.png': 32,
    'icon-64.png': 64,
    'icon-128.png': 128,
  };

  for (const [name, size] of Object.entries(smallSizes)) {
    const png = createPNGBuffer(size, size, pinkR, pinkG, pinkB);
    fs.writeFileSync(path.join(BUILD_DIR, name), png);
    console.log(`✓ Created ${name} (${size}x${size})`);
  }

  // 大图标: 渐变
  const largeSizes = {
    'icon-256.png': 256,
    'icon.png': 256,
  };

  for (const [name, size] of Object.entries(largeSizes)) {
    const png = createPNGBuffer(size, size, null, null, null);
    fs.writeFileSync(path.join(BUILD_DIR, name), png);
    console.log(`✓ Created ${name} (${size}x${size})`);
  }

  // ICO 文件: 包含 32x32 + 256x256
  const ico32 = createPNGBuffer(32, 32, pinkR, pinkG, pinkB);
  const ico256 = createPNGBuffer(256, 256, null, null, null);
  const icoData = createICO([
    { width: 32, height: 32, data: ico32 },
    { width: 256, height: 256, data: ico256 },
  ]);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoData);
  console.log(`✓ Created icon.ico (32x32 + 256x256)`);

  console.log('\n✓ All icons generated!');
}

generateIcons();
