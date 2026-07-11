/**
 * 生成应用图标
 *
 * 调用 Python 脚本 (generate-icons.py) 使用 Pillow 生成
 * 真正的 PNG 图标和多页 ICO 文件。
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'generate-icons.py');

function main() {
  console.log('=== CialloForDesktop Icon Generator ===\n');

  const result = spawnSync('python3', [SCRIPT], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    encoding: 'utf-8',
  });

  if (result.error) {
    console.error('! 无法运行 Python 脚本:', result.error.message);
    console.error('  请确保已安装 Python 3 和 Pillow:');
    console.error('    pip3 install Pillow');
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`! Python 脚本退出码: ${result.status}`);
    process.exit(result.status);
  }
}

main();
