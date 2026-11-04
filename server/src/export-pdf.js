'use strict';
const PDFDocument=require('pdfkit');
const {resolvePdfFont}=require('./pdf-fonts');
function buildPdf(t,draft,opts){return new Promise((resolve,reject)=>{
 t={...t,sections:require('./export-headings').exportSections(t)};
 let font;try{font=resolvePdfFont(opts.font);}catch(e){return reject(e);}
 const doc=new PDFDocument({size:'A4',margins:{top:58,bottom:58,left:58,right:58},bufferPages:true,info:{Title:draft?'测试草稿 · 不用于投标':'技术标',Author:''}}),chunks=[];
 doc.on('data',b=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 try{
  doc.registerFont('body',font.file,font.family);doc.font('body');
  const width=doc.page.width-116,lineGap=opts.line==='1.5'?opts.size*.5:Math.max(0,Number(opts.line)-opts.size);
  doc.fontSize(22).text(draft?'测试草稿 · 不用于投标':'技术标',{align:'center'});doc.moveDown(2);
  if(!opts.blindMode)doc.fontSize(16).text(t.name,{align:'center'});
  if(draft)doc.fontSize(11).text(`自检阻断 ${t.check.blocking} 项。请核对原文和真实资料。`,{align:'center'});
  const tocPages=opts.autoToc?Math.max(1,Math.ceil(t.sections.length/28)):0;
  for(let i=0;i<tocPages;i++)doc.addPage();
  doc.addPage();const headings=[];
  for(const section of t.sections){
   if(doc.y>doc.page.height-120)doc.addPage();
   headings.push({title:section.title,page:doc.bufferedPageRange().count});
   doc.fontSize(16).text(section.title,{width,lineGap:6});doc.moveDown(.6);
   for(const block of section.blocks){
    if(block.type==='table'&&block.rows?.length){doc.fontSize(13).text(block.text);doc.moveDown(.4);for(const row of block.rows){const cellWidth=width/row.length;doc.fontSize(opts.size);const h=Math.max(...row.map(cell=>doc.heightOfString(cell,{width:cellWidth-12,lineGap})))+12;if(doc.y+h>doc.page.height-58)doc.addPage();const y=doc.y;row.forEach((cell,i)=>{doc.rect(58+i*cellWidth,y,cellWidth,h).stroke();doc.text(cell,64+i*cellWidth,y+6,{width:cellWidth-12,lineGap});});doc.x=58;doc.y=y+h;}doc.moveDown(.5);}
    else {doc.fontSize(block.type==='h4'?14:opts.size).text(block.text,{width,lineGap: block.type==='h4'?4:lineGap,paragraphGap:8});doc.moveDown(.3);}
   }
   doc.moveDown(1);
  }
  if(opts.autoToc)for(let i=0;i<tocPages;i++){doc.switchToPage(1+i);doc.x=58;doc.y=58;doc.fontSize(18).text(i?'目录（续）':'目录',{align:'center'});doc.moveDown(1);for(const h of headings.slice(i*28,(i+1)*28)){doc.fontSize(11);const y=doc.y;doc.text(h.title,58,y,{width:width-45,height:28,ellipsis:true});doc.text(String(h.page),58+width-35,y,{width:35,align:'right'});doc.x=58;doc.y=y+24;}}
  const count=doc.bufferedPageRange().count;
  for(let i=0;i<count;i++){doc.switchToPage(i);doc.fontSize(9);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;if(opts.headerFooter)doc.text('技术标',58,30,{width,align:'center',lineBreak:false});if(opts.autoToc||opts.headerFooter)doc.text(String(i+1),58,doc.page.height-35,{width,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;}
  doc.end();
 }catch(e){doc.destroy();reject(e);}
});}
module.exports={buildPdf};
