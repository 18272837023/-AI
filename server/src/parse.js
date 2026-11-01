'use strict';

const path = require('node:path');
const { toLines, logger } = require('./lib/util');

/**
 * M01 文档归一化 + M02 章节树构建。
 *
 * 硬要求（来自设计文档）：**保留页码和章节号**。
 * 没有坐标，后面所有"原文出处"都是假的——用户没法核对，我们也没法免责。
 *
 * P0 的边界，写在代码里也说在 README 里：
 * - DOCX：mammoth 抽纯文本，Word 本身不存分页信息，所以 page = null
 * - PDF ：逐页抽取，page 精确
 * - 扫描版 PDF：抽不到文本会明确报错，不做 OCR（P1 再接）
 */

const EXT_MAP = { '.docx': 'docx', '.pdf': 'pdf', '.txt': 'txt', '.md': 'txt' };

function detectExt(filename) {
  return EXT_MAP[path.extname(String(filename || '')).toLowerCase()] || null;
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || '';
  return {
    ext: 'docx',
    pageKnown: false,
    pages: [{ page: null, text }],
    text,
    warnings: (result.messages || []).slice(0, 5).map((m) => m.message)
  };
}

async function parsePdf(buffer) {
  const pdfParse = require('pdf-parse');
  const pages = [];
  const data = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      let lastY = null;
      let line = '';
      const lines = [];
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
          lines.push(line);
          line = '';
        }
        line += item.str;
        lastY = y;
      }
      if (line) lines.push(line);
      const text = lines.join('\n');
      pages.push({ page: pages.length + 1, text });
      return text;
    }
  });

  const text = pages.map((p) => p.text).join('\n');
  return {
    ext: 'pdf',
    pageKnown: true,
    pages,
    text,
    pageCount: data.numpages || pages.length,
    warnings: []
  };
}

function parseTxt(buffer) {
  const text = buffer.toString('utf8');
  return { ext: 'txt', pageKnown: false, pages: [{ page: null, text }], text, warnings: [] };
}

async function parseFile(buffer, filename) {
  const ext = detectExt(filename);
  if (!ext) {
    throw Object.assign(new Error(`不支持的文件类型：${filename}。P0 只收 PDF / DOCX / TXT`), { statusCode: 415 });
  }

  let doc;
  if (ext === 'docx') doc = await parseDocx(buffer);
  else if (ext === 'pdf') doc = await parsePdf(buffer);
  else doc = parseTxt(buffer);

  const charCount = doc.text.replace(/\s/g, '').length;
  if (charCount < 200) {
    throw Object.assign(
      new Error(
        `只抽到 ${charCount} 个字符，这份文件可能是扫描件或加密 PDF。` +
          'P0 不做 OCR，请提供文字版 PDF 或 Word 原件。'
      ),
      { statusCode: 422, detail: { charCount } }
    );
  }

  doc.charCount = charCount;
  doc.filename = filename;
  logger.info(`解析完成：${filename} → ${charCount} 字 / ${doc.pages.length} 页`);
  return doc;
}

/* ---------------- M02 章节树 ---------------- */

const RE_CHAPTER = /^第\s*([一二三四五六七八九十百零〇\d]+)\s*章[\s、.：:]*(.*)$/;
const RE_SECTION = /^第\s*([一二三四五六七八九十百零〇\d]+)\s*节[\s、.：:]*(.*)$/;
const RE_NUM = /^(\d{1,2}(?:\.\d{1,2}){0,3})[\s、.．:：]+\s*(\S.{0,38})$/;
const RE_CN_NUM = /^([一二三四五六七八九十]{1,3})\s*[、.．]\s*(\S.{0,38})$/;
const RE_PAREN = /^[（(]([一二三四五六七八九十\d]{1,3})[)）]\s*(\S.{0,38})$/;
const RE_APPENDIX = /^(附件|附录)\s*[一二三四五六七八九十\d]*[\s:：]*(.*)$/;

/** 标题行不该长这样：带句号结尾、过长、纯数字 */
function looksLikeParagraph(line) {
  if (line.length > 42) return true;
  if (/[。；;]$/.test(line)) return true;
  return false;
}

function detectHeading(line) {
  if (looksLikeParagraph(line)) return null;

  let m = RE_CHAPTER.exec(line);
  if (m) return { level: 1, no: `第${m[1]}章`, title: (m[2] || '').trim() || line };

  m = RE_SECTION.exec(line);
  if (m) return { level: 2, no: `第${m[1]}节`, title: (m[2] || '').trim() || line };

  m = RE_APPENDIX.exec(line);
  if (m) return { level: 1, no: m[1], title: (m[2] || '').trim() || line };

  m = RE_NUM.exec(line);
  if (m) {
    const depth = m[1].split('.').length;
    return { level: Math.min(4, depth + 1), no: m[1], title: m[2].trim() };
  }

  m = RE_CN_NUM.exec(line);
  if (m) return { level: 2, no: m[1] + '、', title: m[2].trim() };

  m = RE_PAREN.exec(line);
  if (m) return { level: 3, no: `（${m[1]}）`, title: m[2].trim() };

  return null;
}

/**
 * 遍历 pages → lines，边切章节边记页码。
 * 返回的 sections 是平铺数组，靠 level 表达层级（前端渲染时按 level 缩进）。
 */
function buildSections(doc) {
  const sections = [];
  let current = null;
  let buffer = [];
  let seq = 0;

  const flush = () => {
    if (current) {
      current.text = buffer.join('\n').trim();
      current.charCount = current.text.replace(/\s/g, '').length;
      sections.push(current);
    }
    buffer = [];
  };

  for (const page of doc.pages) {
    const lines = toLines(page.text);
    for (const line of lines) {
      const head = detectHeading(line);
      if (head) {
        flush();
        seq += 1;
        current = {
          id: 's' + String(seq).padStart(3, '0'),
          level: head.level,
          no: head.no,
          title: head.title,
          page: page.page,
          text: '',
          charCount: 0
        };
      } else if (current) {
        buffer.push(line);
      }
    }
  }
  flush();

  if (!sections.length) {
    // 一个标题都没识别出来：降级为平铺，仍然可用（设计文档里的失败策略）
    const text = doc.text.trim();
    sections.push({
      id: 's001',
      level: 1,
      no: '',
      title: doc.filename || '全文',
      page: doc.pageKnown ? 1 : null,
      text,
      charCount: text.replace(/\s/g, '').length,
      degraded: true
    });
    logger.warn('未识别到章节标题，已降级为平铺结构');
  }

  return sections;
}

module.exports = { parseFile, buildSections, detectHeading, detectExt };
