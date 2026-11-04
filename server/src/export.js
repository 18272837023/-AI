'use strict';
// 真正的 OOXML Word 包；使用已有 JSZip 依赖，不依赖 Office 安装。
const JSZip = require('jszip');
function xml(s) {
  return String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function para(text, style = 'Normal') {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}
async function buildDocx(t, draft, options) {
  t={...t,sections:require('./export-headings').exportSections(t)};
  const opts=options||{font:'宋体',size:12,line:'1.5',autoToc:false,headerFooter:false,blindMode:true};
  const zip = new JSZip();
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = [para(draft ? '测试草稿 · 不用于投标' : '技术标', 'Title')];
  // 不写项目名或作者，避免在默认暗标文档中引入身份信息。
  if (draft) paragraphs.push(para(`自检阻断 ${t.check.blocking} 项；请核对原文及全部待确认内容。`));
  if(!opts.blindMode)paragraphs.push(para(t.name));
  paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  if(opts.autoToc){paragraphs.push(para('目录','Heading1'));paragraphs.push('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>');paragraphs.push(...t.sections.map(s=>para(s.title)));paragraphs.push('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>');}
  for (const s of t.sections) {
    paragraphs.push(para(s.title, 'Heading1'));
    for (const b of s.blocks) {
      if(b.type==='table'&&b.rows?.length){const width=Math.floor(9026/b.rows[0].length);paragraphs.push(para(b.text,'Caption'));paragraphs.push('<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(edge=>`<w:${edge} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')+'</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+b.rows[0].map(()=>`<w:gridCol w:w="${width}"/>`).join('')+'</w:tblGrid>'+b.rows.map((row,i)=>'<w:tr>'+(i===0?'<w:trPr><w:tblHeader/></w:trPr>':'')+row.map(cell=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>`+para(cell,'TableText')+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>');continue;}
      for(const line of b.text.split(/\r?\n/))paragraphs.push(para(line,b.type==='h4'?'Heading2':'Normal'));
    }
  }
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', `<w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[['Normal', 24], ['Title', 36], ['Heading1', 30], ['Heading2', 26]].map(([id, size]) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr>${id === 'Normal' ? '<w:ind w:firstLine="480"/>' : '<w:keepNext/>'}${id.startsWith('Heading') ? `<w:outlineLvl w:val="${id === 'Heading1' ? 0 : 1}"/>` : ''}</w:pPr><w:rPr><w:sz w:val="${size}"/>${id === 'Normal' ? '' : '<w:b/>'}</w:rPr></w:style>`).join('')}</w:styles>`);
  let styles=await zip.file('word/styles.xml').async('string');
  styles=styles.replace('w:eastAsia="宋体"',`w:eastAsia="${opts.font}"`).replace(/w:sz w:val="24"/g,`w:sz w:val="${opts.size*2}"`).replace('w:line="360" w:lineRule="auto"',opts.line==='1.5'?'w:line="360" w:lineRule="auto"':`w:line="${Number(opts.line)*20}" w:lineRule="exact"`);
  zip.file('word/styles.xml',styles);
  // 显式定义继承、中文字体、字号及标题大纲级别，减少微信/WPS 的默认样式差异。
  styles=styles.replace(/<w:style w:type="paragraph" w:styleId="Normal">/,'<w:style w:type="paragraph" w:default="1" w:styleId="Normal">').replace(/<w:name w:val="(Title|Heading1|Heading2)"\/>/g,'<w:name w:val="$1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>').replace(/<w:keepNext\/>/g,'<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="160"/><w:ind w:firstLine="0"/>').replace('</w:styles>',`<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:after="0" w:line="300" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`);
  zip.file('word/styles.xml',styles);
  let types=await zip.file('[Content_Types].xml').async('string'),rels=await zip.file('word/_rels/document.xml.rels').async('string');
  const extra=[];
  function part(name,type,content){zip.file('word/'+name+'.xml',content);types=types.replace('</Types>',`<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/></Types>`);rels=rels.replace('</Relationships>',`<Relationship Id="r${name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${name}.xml"/></Relationships>`);}
  if(opts.headerFooter){part('header1','header',`<w:hdr xmlns:w="${ns}">${para('技术标')}</w:hdr>`);extra.push('<w:headerReference w:type="default" r:id="rheader1"/>');}
  if(opts.headerFooter||opts.autoToc){part('footer1','footer',`<w:ftr xmlns:w="${ns}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`);extra.push('<w:footerReference w:type="default" r:id="rfooter1"/>');}
  part('settings','settings',`<w:settings xmlns:w="${ns}"><w:updateFields w:val="true"/></w:settings>`);
  zip.file('[Content_Types].xml',types);zip.file('word/_rels/document.xml.rels',rels);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraphs.join('')}<w:sectPr>${extra.join('')}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
module.exports = { buildDocx };
