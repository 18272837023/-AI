'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolvePdfFont } = require('../src/pdf-fonts');

test('Linux 三种 PDF 字体独立映射，支持自定义 TTC 家族且缺失时报错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-fonts-'));
  try {
    const files = ['FandolSong-Regular.otf', 'FandolHei-Regular.otf', 'FandolFang-Regular.otf'];
    for (const file of files) fs.writeFileSync(path.join(dir, file), 'resolver fixture');
    ['宋体', '黑体', '仿宋'].forEach((name, index) => {
      assert.equal(resolvePdfFont(name, { platform: 'linux', env: { PDF_FONT_DIR: dir } }).file, path.join(dir, files[index]));
    });
    const custom = resolvePdfFont('宋体', { platform: 'linux', env: {
      PDF_FONT_SONG: path.join(dir, files[0]), PDF_FONT_SONG_FAMILY: 'CustomCollection'
    } });
    assert.equal(custom.family, 'CustomCollection');
    assert.throws(() => resolvePdfFont('宋体', { platform: 'linux', env: { PDF_FONT_SONG: path.join(dir, 'missing.ttf') } }), { statusCode: 503 });
    assert.throws(() => resolvePdfFont('未知'), { statusCode: 400 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
