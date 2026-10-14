import type { PDFImage } from 'pdf-lib';
import { assetBlob, imageBlob } from './media';
import { paginate, MM, type Measure } from './layout';
import type { Trip, Page } from './types';
let fontData:Promise<Uint8Array>|undefined;
let measurement:Promise<Measure>|undefined;
export function fontBytes():Promise<Uint8Array>{
  if(!fontData)fontData=fetch('/fonts/travel-sans.ttf').then(async response=>{if(!response.ok)throw new Error('打印字体加载失败，请检查服务中的字体文件。');return new Uint8Array(await response.arrayBuffer());}).catch(error=>{fontData=undefined;throw error;});
  return fontData;
}
export function getMeasure():Promise<Measure>{
  if(!measurement)measurement=(async()=>{const [{PDFDocument},{default:fontkit}]=await Promise.all([import('pdf-lib'),import('@pdf-lib/fontkit')]);const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(await fontBytes(),{subset:true});return (text:string,size:number)=>font.widthOfTextAtSize(text,size)/MM;})().catch(error=>{measurement=undefined;throw error;});
  return measurement;
}
export const printPages=async(trip:Trip)=>paginate(trip,await getMeasure());
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export const safeName=(name:string)=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80)||'游记';
export async function exportPDF(trip:Trip,pages:Page[],progress?:(value:string)=>void):Promise<void>{
  const [{PDFDocument,rgb,pushGraphicsState,popGraphicsState,rectangle,clip,endPath},{default:fontkit}]=await Promise.all([import('pdf-lib'),import('@pdf-lib/fontkit')]);
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(await fontBytes(),{subset:false});doc.setTitle(trip.title);doc.setAuthor('行迹');doc.setSubject('家庭旅行游记');
  const images=new Map<string,PDFImage>();
  for(let index=0;index<pages.length;index++){
    progress?.(`正在生成第 ${index+1} / ${pages.length} 页`);
    const page=doc.addPage([210*MM,297*MM]);
    for(const block of pages[index].blocks){
      if(block.type==='text'){
        const color=block.color||'#263e35';const parts=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16)/255);
        page.drawText(block.text,{x:block.x*MM,y:(297-block.y)*MM-block.size*0.88,size:block.size,font,color:rgb(parts[0],parts[1],parts[2])});
      }else{
        let image=images.get(block.assetId);
        if(!image){const asset=trip.assets.find(a=>a.id===block.assetId);if(!asset)throw new Error('页面引用的素材不存在。');
          const original=await assetBlob(asset,asset.kind==='image');if(!original)throw new Error(`找不到「${asset.name}」，请先重新关联素材。`);
          const normalized=await imageBlob(original,4800);image=await doc.embedJpg(await normalized.blob.arrayBuffer());images.set(asset.id,image);}
        const x=block.x*MM,y=(297-block.y-block.height)*MM,w=block.width*MM,h=block.height*MM;
        const asset=trip.assets.find(a=>a.id===block.assetId);
        const scale=asset?.fit==='contain'?Math.min(w/image.width,h/image.height):Math.max(w/image.width,h/image.height),iw=image.width*scale,ih=image.height*scale;
        page.pushOperators(pushGraphicsState(),rectangle(x,y,w,h),clip(),endPath());
        page.drawImage(image,{x:x+(w-iw)*(asset?.cropX??50)/100,y:y+(h-ih)*(1-(asset?.cropY??50)/100),width:iw,height:ih});page.pushOperators(popGraphicsState());
      }
    }
  }
  const bytes=await doc.save();download(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),`${safeName(trip.title)}.pdf`);
}
