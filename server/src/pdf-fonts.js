'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FONTS = {
  '宋体': { key: 'SONG', windows: 'simsun.ttc', family: 'SimSun', linux: 'FandolSong-Regular.otf' },
  '黑体': { key: 'HEI', windows: 'simhei.ttf', linux: 'FandolHei-Regular.otf' },
  '仿宋': { key: 'FANG', windows: 'simfang.ttf', linux: 'FandolFang-Regular.otf' }
};

function resolvePdfFont(name, { platform = process.platform, env = process.env } = {}) {
  const font = FONTS[name];
  if (!font) throw Object.assign(new Error('无效 PDF 字体'), { statusCode: 400 });
  const custom = env['PDF_FONT_' + font.key];
  const file = custom || (platform === 'win32'
    ? path.join(env.WINDIR || 'C:/Windows', 'Fonts', font.windows)
    : path.join(env.PDF_FONT_DIR || '/usr/local/share/fonts/fandol', font.linux));
  const family = env['PDF_FONT_' + font.key + '_FAMILY'] || (!custom && platform === 'win32' ? font.family : undefined);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw Object.assign(new Error('PDF 中文字体未安装，请配置 PDF_FONT_DIR 或对应的 PDF_FONT_' + font.key), { statusCode: 503 });
  }
  return { file, family };
}

module.exports = { resolvePdfFont };
