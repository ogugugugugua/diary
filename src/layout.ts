import type { Trip, Page, TextBlock, Asset } from './types';
export const MM = 72 / 25.4;
export type Measure = (text: string, size: number) => number;
export const approximateMeasure: Measure = (text,size) => Array.from(text).reduce((n,c)=>n + (/[^\x00-\xff]/.test(c)?1:0.55)*size/MM,0);
export function wrapText(text:string,width:number,size:number,measure:Measure=approximateMeasure):string[] {
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r/g,'').split('\n')) {
    if(!paragraph.trim()) {lines.push('');continue;}
    let line='';
    for(const character of Array.from(paragraph)) {
      if(line && measure(line+character,size)>width) {lines.push(line.trimEnd());line=character===' '?'':character;}
      else line+=character;
    }
    if(line)lines.push(line.trimEnd());
  }
  return lines;
}
export function paginate(trip:Trip,measure:Measure=approximateMeasure):Page[] {
  const pages:Page[]=[], margin=trip.margin, left=margin+trip.binding, width=210-left-margin, bottom=297-margin-10;
  const text=(x:number,y:number,value:string,size:number,color='#263e35'):TextBlock=>({type:'text',x,y,text:value,size,color});
  const assets = new Map(trip.assets.map(a=>[a.id,a]));
  const cover=assets.get(trip.coverId||'') || trip.assets.find(a=>a.selected);
  const coverPage:Page={chapterId:'cover',title:'封面',cover:true,blocks:[text(left,margin,'XINGJI  /  FAMILY TRAVEL JOURNAL',8,'#7c837b')]};
  if(cover && !cover.missing && (cover.kind==='image'||cover.thumbnailKey))coverPage.blocks.push({type:'image',x:left,y:margin+12,width,height:142,assetId:cover.id});
  const titles=wrapText(trip.title,width,25,measure);
  titles.slice(0,3).forEach((line,i)=>coverPage.blocks.push(text(left,margin+165+i*13,line,25)));
  wrapText(trip.subtitle,width,11,measure).slice(0,3).forEach((line,i)=>coverPage.blocks.push(text(left,margin+210+i*6,line,11,'#70776c')));
  coverPage.blocks.push(text(left,267,`${trip.startDate.replaceAll('-','.')} ${trip.endDate&&trip.endDate!==trip.startDate?`— ${trip.endDate.replaceAll('-','.')}`:''}`.trim(),10,'#70776c'));
  pages.push(coverPage);
  for(const chapter of trip.chapters) {
    const selected=chapter.assetIds.map(a=>assets.get(a)).filter((a):a is Asset=>!!a&&a.selected&&!a.missing&&(a.kind==='image'||!!a.thumbnailKey));
    const lines=wrapText(chapter.body,width,11,measure);
    const perPage=chapter.layout==='album'?4:chapter.layout==='journal'?1:2;
    let photoIndex=0,lineIndex=0,first=true;
    do {
      const page:Page={chapterId:chapter.id,title:chapter.title,blocks:[text(left,12,trip.title,8,'#898d82')]};
      let y=margin+10;
      const heading=wrapText(first?chapter.title:`${chapter.title} · 续`,width,17,measure).slice(0,3);
      heading.forEach(line=>{page.blocks.push(text(left,y,line,17));y+=9;}); y+=5;
      const batch=selected.slice(photoIndex,photoIndex+perPage);photoIndex+=batch.length;
      if(batch.length) {
        const columns=chapter.layout==='journal'||batch.length===1?1:2;
        const defaultHeight=chapter.layout==='album'?62:chapter.layout==='journal'?68:86;
        const photoHeight=Math.min(chapter.layout==='album'?75:110,Math.max(40,chapter.imageHeight??defaultHeight));
        const cellWidth=(width-(columns-1)*5)/columns;
        batch.forEach((asset,index)=>{
          const row=Math.floor(index/columns),x=left+(index%columns)*(cellWidth+5),rowY=y+row*(photoHeight+16);
          page.blocks.push({type:'image',x,y:rowY,width:cellWidth,height:photoHeight,assetId:asset.id});
          const caption=wrapText(asset.caption||asset.name,cellWidth,8,measure).slice(0,2);
          caption.forEach((line,i)=>page.blocks.push(text(x,rowY+photoHeight+3+i*4,line,8,'#787d71')));
        });
        y+=Math.ceil(batch.length/columns)*(photoHeight+16)+2;
      }
      while(lineIndex<lines.length && y+6<=bottom) {
        const line=lines[lineIndex++];if(line)page.blocks.push(text(left,y,line,11));y+=line?6.3:4;
      }
      pages.push(page);first=false;
    }while(photoIndex<selected.length||lineIndex<lines.length);
  }
  pages.forEach((page,index)=>{if(!page.cover)page.blocks.push(text(100,284,String(index+1).padStart(2,'0'),8,'#8d9088'));});
  return pages;
}
export function printWarnings(trip:Trip,pages:Page[]):{assetId?:string;message:string}[] {
  const warnings:{assetId?:string;message:string}[]=[], seen=new Set<string>(), captionSeen=new Set<string>();
  for(const page of pages)for(const block of page.blocks)if(block.type==='image') {
    const asset=trip.assets.find(a=>a.id===block.assetId);if(!asset)continue;
    const ratios=[(asset.renderWidth||asset.width)/(block.width/25.4),(asset.renderHeight||asset.height)/(block.height/25.4)],dpi=asset.fit==='contain'?Math.max(...ratios):Math.min(...ratios);
    if(!seen.has(asset.id)&&dpi<150)warnings.push({assetId:asset.id,message:`「${asset.name}」在当前版式下约${Math.round(dpi)} DPI，建议换用更清晰的原图或缩小尺寸。`});
    if(!page.cover&&!captionSeen.has(asset.id)){if(wrapText(asset.caption||asset.name,block.width,8).length>2)warnings.push({assetId:asset.id,message:`「${asset.name}」的图注超过两行，页面仅显示前两行，建议缩短图注或把故事放入正文。`});captionSeen.add(asset.id);}
    seen.add(asset.id);
  }
  const referenced=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]);
  for(const asset of trip.assets)if(asset.missing&&referenced.has(asset.id))warnings.push({assetId:asset.id,message:`「${asset.name}」的原文件未恢复，请重新关联。`});
  if(!trip.chapters.length)warnings.push({message:'当前只有封面。可以先在编辑页添加章节。'});
  if(trip.title.length>60)warnings.push({message:'标题较长，封面最多显示三行，请缩短标题并查看预览。'});
  const width=210-trip.margin*2-trip.binding;
  if(wrapText(trip.subtitle,width,11).length>3)warnings.push({message:'封面简介超过三行，请缩短简介并查看预览。'});
  for(const chapter of trip.chapters){if(wrapText(chapter.title,width,17).length>3)warnings.push({message:`「${chapter.title.slice(0,20)}…」标题超过三行，请缩短章节标题。`});if(!chapter.body.trim()&&!chapter.assetIds.some(id=>trip.assets.some(a=>a.id===id&&a.selected)))warnings.push({message:`「${chapter.title}」只有章节标题，请确认是否保留此页。`});}
  return warnings;
}
