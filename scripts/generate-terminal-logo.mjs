// 开发时将本地 SVG 转为盲文字符图；运行 CLI 不需要浏览器或图片处理。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const source = new URL('../src/cli/ui/assets/bangumi.svg', import.meta.url);
const target = new URL('../src/cli/ui/logo.ts', import.meta.url);
const svg = await readFile(source, 'utf8');
const columns = 12;
const rows = 6;
const threshold = 70;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const pixels = await page.evaluate(async ({ svg, width, height }) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    return Array.from(context.getImageData(0, 0, width, height).data);
  }, { svg, width: columns * 2, height: rows * 4 });
  const bits = [[0, 3], [1, 4], [2, 5], [6, 7]];
  const lines = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    let mask = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      if (pixels[((row * 4 + y) * columns * 2 + column * 2 + x) * 4 + 3] >= threshold) mask |= 1 << bits[y][x];
    }
    return mask ? String.fromCodePoint(0x2800 + mask) : ' ';
  }).join(''));
  const color = /fill="(#[\da-f]{6})"/i.exec(svg)?.[1];
  if (!color) throw new Error('SVG 缺少图标颜色。');
  await writeFile(target, `// 由 scripts/generate-terminal-logo.mjs 从 assets/bangumi.svg 生成；请勿手工修改。\n// 源文件 SHA-256：${createHash('sha256').update(svg).digest('hex')}；${columns}列×${rows}行，alpha阈值${threshold}。\nexport const LOGO_COLOR = '${color}';\nexport const LOGO_COLUMNS = ${columns};\nexport const LOGO_LINES: readonly string[] = ${JSON.stringify(lines, null, 2)};\n`, 'utf8');
  console.log(lines.join('\n'));
} finally {
  await browser.close();
}
