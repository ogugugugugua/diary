import { cameraDate, validOffset } from './itinerary';
import { id } from './domain';
import { getBlob } from './db';
import type { Asset } from './types';
import * as legacy from './legacy-db';
import { isNativeStore, blobURL, nativeBlobInfo, sourceURL, nativeRequest, releaseRemote, putNativeBlob } from './native';

export async function imageBlob(blob: Blob, maxWidth = 1800): Promise<{blob: Blob; width: number; height: number;renderWidth:number;renderHeight:number}> {
  const image = await createImageBitmap(blob);
  const width = image.width, height = image.height;
  const scale = Math.min(1, maxWidth / Math.max(width, height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器不支持图片处理。');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片处理失败。')), 'image/jpeg', 0.9));
  return {blob: output, width, height,renderWidth:canvas.width,renderHeight:canvas.height};
}
function mediaEvent(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('视频读取超时；可以先转为常见MP4格式。')), 15000);
    const success = () => done(); const error = () => done(new Error('当前浏览器无法解码这个视频。'));
    function done(reason?: Error) { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', error); reason ? reject(reason) : resolve(); }
    video.addEventListener(event, success, {once:true}); video.addEventListener('error', error, {once:true});
  });
}
export async function videoFrame(blob: Blob|string, time = 0.5): Promise<{blob: Blob; width: number; height: number; duration: number}> {
  const src = typeof blob==='string'?blob:URL.createObjectURL(blob), video = document.createElement('video');
  video.muted = true; video.preload = 'auto'; video.playsInline = true;
  try {
    const ready = mediaEvent(video, 'loadeddata'); video.src = src; video.load(); await ready;
    const seek = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));
    if (seek > 0) { const seeking = mediaEvent(video, 'seeked'); video.currentTime = seek; await seeking; }
    const width = video.videoWidth, height = video.videoHeight, scale = Math.min(1, 2400 / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('无法提取视频画面。')), 'image/jpeg', 0.92));
    return {blob: frame, width: canvas.width, height: canvas.height, duration: video.duration};
  } finally { video.removeAttribute('src'); video.load(); if(typeof blob!=='string')URL.revokeObjectURL(src); }
}
export async function readAsset(file: File): Promise<{asset: Asset; blobs: {key: string; blob: Blob}[]}> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const video = file.type.startsWith('video/') || /^(mp4|mov|m4v|webm)$/.test(extension);
  if (!video && !file.type.startsWith('image/') && !/^(jpe?g|png|webp|heic|heif|avif)$/.test(extension)) throw new Error('请选择照片或视频文件。');
  if (!video&&file.size > 500 * 1024 ** 2) throw new Error('单张照片暂限500 MB，超大照片请通过目录引用。');
  let fingerprint: string;
  if (!video) {
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    fingerprint = `sha256:${Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, '0')).join('')}`;
  } else fingerprint = `video:${file.name}:${file.size}:${file.lastModified}`;
  const assetId = id(), blobKey = `media-${assetId}`, thumbnailKey = `thumb-${assetId}`;
  let width = 0, height = 0, renderWidth=0,renderHeight=0,thumbnail: Blob | undefined, date = '', location = '', utcOffset: string|undefined;
  if (video) {
    try { const frame = await videoFrame(file); thumbnail = frame.blob; width = renderWidth=frame.width; height = renderHeight=frame.height; } catch { /* Original remains usable; print selection waits for a decodable frame. */ }
  } else {
    const image = await imageBlob(file,3200); thumbnail = image.blob; width = image.width; height = image.height;renderWidth=image.renderWidth;renderHeight=image.renderHeight;
    try {
      const exifr=(await import('exifr')).default;
      const metadata = await exifr.parse(file, {pick:['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'latitude', 'longitude'],reviveValues:false});
      const shot = metadata?.DateTimeOriginal || metadata?.CreateDate;
      date = cameraDate(shot); utcOffset = validOffset(metadata?.OffsetTimeOriginal) ? metadata.OffsetTimeOriginal : undefined;
      if (typeof metadata?.latitude === 'number' && typeof metadata?.longitude === 'number') location = `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`;
    } catch { /* Missing EXIF is a normal case. */ }
  }
  return {asset: {id: assetId, name:file.name, kind:video?'video':'image', size:file.size, width, height, date, utcOffset, location, caption:'', selected:!!thumbnail,
    fingerprint, blobKey, thumbnailKey:thumbnail ? thumbnailKey : undefined,renderWidth,renderHeight}, blobs: [{key:blobKey, blob:file}, ...(thumbnail ? [{key:thumbnailKey, blob:thumbnail}] : [])]};
}
let activePreviews=0;const waiting:(()=>void)[]=[],pendingPreviews=new Map<string,Promise<Blob|undefined>>();
async function limitedPreview<T>(task:()=>Promise<T>):Promise<T>{if(activePreviews>=2)await new Promise<void>(resolve=>waiting.push(resolve));else activePreviews++;try{return await task();}finally{const next=waiting.shift();if(next)next();else activePreviews--;}}
export function printKey(asset:Asset){return `print-${asset.source?.id}-${asset.source?.version}`;}
async function referencePreview(asset:Asset,quality:'thumb'|'print'):Promise<Blob|undefined>{
  const key=`${asset.source?.id}:${asset.source?.version}:${quality}`;const pending=pendingPreviews.get(key);if(pending)return pending;
  const operation=limitedPreview(async()=>{
    const cached=await fetch(sourceURL(asset,'preview',quality));if(cached.ok)return cached.blob();if(cached.status!==404)throw new Error((await cached.json()).error||'读取画面失败。');
    let input:Blob|undefined;
    if(quality==='thumb'){const printed=await fetch(sourceURL(asset,'preview','print'));if(printed.ok)input=await printed.blob();}
    let picture:Blob,width=asset.width,height=asset.height;
    if(input){const small=await imageBlob(input,640);picture=small.blob;}
    else {
      if(asset.source?.kind==='baidu'){const info=await nativeRequest<{prepared:boolean}>(sourceURL(asset,'info').replace('/api/library',''));if(!info.prepared)throw new Error('网盘原片尚未准备，请打开详情按需下载。');}
      if(asset.kind==='video'){const frame=await videoFrame(sourceURL(asset));width=frame.width;height=frame.height;picture=quality==='thumb'?(await imageBlob(frame.blob,640)).blob:frame.blob;}
      else{if(asset.size>500*1024**2)throw new Error('原照片超过500 MB，请先生成较小的图片用于排版。');const response=await fetch(sourceURL(asset));if(!response.ok)throw new Error((await response.json()).error||'原照片不可用。');const image=await imageBlob(await response.blob(),quality==='thumb'?640:3200);picture=image.blob;width=image.width;height=image.height;}
    }
    const url=sourceURL(asset,'preview',quality)+`&width=${width}&height=${height}`;
    const saved=await fetch(url,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:picture});if(!saved.ok)throw new Error((await saved.json()).error||'画面保存失败。');
    if(asset.source?.kind==='baidu'&&asset.kind==='image')await releaseRemote(asset);
    return picture;
  }).finally(()=>pendingPreviews.delete(key));pendingPreviews.set(key,operation);return operation;
}
export async function assetBlob(asset: Asset, original = false,quality:'thumb'|'print'='print'): Promise<Blob | undefined> {
  if(!original&&asset.thumbnailKey){const saved=await getBlob(asset.thumbnailKey);if(saved)return saved;}
  if(asset.source&&asset.source.kind!=='legacy'&&isNativeStore()){
    if(!original)return referencePreview(asset,quality);
    const response=await fetch(sourceURL(asset));if(!response.ok)return undefined;return response.blob();
  }
  if (asset.src) { const response = await fetch(asset.src); if (!response.ok) return undefined; return response.blob(); }
  return getBlob(original ? asset.blobKey : asset.thumbnailKey || asset.blobKey);
}
export async function assetURL(asset: Asset, original = false,quality:'thumb'|'print'='thumb'): Promise<{url: string; revoke: boolean}> {
  if(original&&isNativeStore()){
    if(asset.source&&asset.source.kind!=='legacy'){const state=await nativeRequest<{available:boolean}>(sourceURL(asset,'info').replace('/api/library',''));return {url:state.available?sourceURL(asset):'',revoke:false};}
    if(asset.blobKey&&await nativeBlobInfo(asset.blobKey))return {url:blobURL(asset.blobKey),revoke:false};
  }
  if (asset.src) return {url:asset.src, revoke:false};
  const blob = await assetBlob(asset, original,quality);
  return blob ? {url:URL.createObjectURL(blob), revoke:true} : {url:'', revoke:false};
}
export async function prepareTripMedia(trip:import('./types').Trip,progress?:(text:string)=>void,originals=false){
  const referenced=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]),assets=[...trip.assets];let done=0;
  for(let index=0;index<assets.length;index++){const asset=assets[index];if(!referenced.has(asset.id))continue;progress?.(`正在保留游记画面：${++done} / ${referenced.size} · ${asset.name}`);
    const blob=await assetBlob(asset);if(!blob)throw new Error(`「${asset.name}」缺少可打印画面，请重新关联或选取关键帧。`);const bitmap=await createImageBitmap(blob);const width=bitmap.width,height=bitmap.height;bitmap.close();let thumbnailKey=asset.thumbnailKey;
    if(isNativeStore()&&(!asset.source||asset.source.kind==='legacy'||thumbnailKey)){thumbnailKey??=`thumb-${asset.id}`;if(!await nativeBlobInfo(thumbnailKey))await putNativeBlob(thumbnailKey,blob,'retained');}
    let blobKey=asset.blobKey;
    if(originals&&isNativeStore()&&(!asset.source||asset.source.kind==='legacy')){if(!blobKey||!await nativeBlobInfo(blobKey)){const original=asset.blobKey?await legacy.getBlob(asset.blobKey):await assetBlob(asset,true);if(!original)throw new Error(`「${asset.name}」的原件不可用。`);blobKey??=`media-${asset.id}`;await putNativeBlob(blobKey,original,'original');}}
    assets[index]={...asset,thumbnailKey,blobKey,renderWidth:width,renderHeight:height,missing:false};
  }
  for(const memory of trip.memories)if(memory.audioKey&&isNativeStore()&&!await nativeBlobInfo(memory.audioKey)){const audio=await legacy.getBlob(memory.audioKey);if(!audio)throw new Error('原始录音未迁移。');await putNativeBlob(memory.audioKey,audio,'retained');}
  return {...trip,assets};
}
const warmed=new Set<string>(),warming=new Map<string,Promise<void>>();
export function warmTripMedia(trip:import('./types').Trip){if(!isNativeStore())return;const used=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]);for(const asset of trip.assets){if(!used.has(asset.id)||!asset.source||asset.source.kind==='legacy'||asset.thumbnailKey)continue;const key=printKey(asset);if(warmed.has(key)||warming.has(key))continue;const task=(async()=>{if(!await nativeBlobInfo(key))await assetBlob(asset);warmed.add(key);})().catch(()=>{}).finally(()=>warming.delete(key));warming.set(key,task);}}
if(typeof window!=='undefined')window.addEventListener('xingji:media-refresh',()=>warmed.clear());
export const dataURL = (blob: Blob): Promise<string> => new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(blob); });
export async function visionImages(assets: Asset[]): Promise<string[]> {
  const result:string[]=[];
  for (const asset of assets.slice(0,6)) { const blob=await assetBlob(asset,false,'thumb'); if(blob) result.push(await dataURL((await imageBlob(blob,640)).blob)); }
  return result;
}
