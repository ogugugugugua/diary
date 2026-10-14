import { id } from './domain';
import { getBlob } from './db';
import type { Asset } from './types';

export async function imageBlob(blob: Blob, maxWidth = 1800): Promise<{blob: Blob; width: number; height: number}> {
  const image = await createImageBitmap(blob);
  const width = image.width, height = image.height;
  const scale = Math.min(1, maxWidth / Math.max(width, height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器不支持图片处理。');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片处理失败。')), 'image/jpeg', 0.9));
  return {blob: output, width, height};
}
function mediaEvent(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('视频读取超时；可以先转为常见MP4格式。')), 15000);
    const success = () => done(); const error = () => done(new Error('当前浏览器无法解码这个视频。'));
    function done(reason?: Error) { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', error); reason ? reject(reason) : resolve(); }
    video.addEventListener(event, success, {once:true}); video.addEventListener('error', error, {once:true});
  });
}
export async function videoFrame(blob: Blob, time = 0.5): Promise<{blob: Blob; width: number; height: number; duration: number}> {
  const src = URL.createObjectURL(blob), video = document.createElement('video');
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
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(src); }
}
export async function readAsset(file: File): Promise<{asset: Asset; blobs: {key: string; blob: Blob}[]}> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const video = file.type.startsWith('video/') || /^(mp4|mov|m4v|webm)$/.test(extension);
  if (!video && !file.type.startsWith('image/') && !/^(jpe?g|png|webp|heic|heif|avif)$/.test(extension)) throw new Error('请选择照片或视频文件。');
  if (file.size > 500 * 1024 ** 2) throw new Error('单个文件暂限500 MB，请先截取较短的视频片段。');
  let fingerprint: string;
  if (!video) {
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    fingerprint = `sha256:${Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, '0')).join('')}`;
  } else fingerprint = `video:${file.name}:${file.size}:${file.lastModified}`;
  const assetId = id(), blobKey = `media-${assetId}`, thumbnailKey = `thumb-${assetId}`;
  let width = 0, height = 0, thumbnail: Blob | undefined, date = '', location = '';
  if (video) {
    try { const frame = await videoFrame(file); thumbnail = frame.blob; width = frame.width; height = frame.height; } catch { /* Original remains usable; print selection waits for a decodable frame. */ }
  } else {
    const image = await imageBlob(file); thumbnail = image.blob; width = image.width; height = image.height;
    try {
      const exifr=(await import('exifr')).default;
      const metadata = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude']);
      const shot = metadata?.DateTimeOriginal || metadata?.CreateDate;
      if (shot instanceof Date && !Number.isNaN(shot.getTime())) date = `${shot.getFullYear()}-${String(shot.getMonth()+1).padStart(2,'0')}-${String(shot.getDate()).padStart(2,'0')}`;
      if (typeof metadata?.latitude === 'number' && typeof metadata?.longitude === 'number') location = `${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`;
    } catch { /* Missing EXIF is a normal case. */ }
  }
  return {asset: {id: assetId, name:file.name, kind:video?'video':'image', size:file.size, width, height, date, location, caption:'', selected:!!thumbnail,
    fingerprint, blobKey, thumbnailKey:thumbnail ? thumbnailKey : undefined}, blobs: [{key:blobKey, blob:file}, ...(thumbnail ? [{key:thumbnailKey, blob:thumbnail}] : [])]};
}
export async function assetBlob(asset: Asset, original = false): Promise<Blob | undefined> {
  if (asset.src) { const response = await fetch(asset.src); if (!response.ok) return undefined; return response.blob(); }
  return getBlob(original ? asset.blobKey : asset.thumbnailKey || asset.blobKey);
}
export async function assetURL(asset: Asset, original = false): Promise<{url: string; revoke: boolean}> {
  if (asset.src) return {url:asset.src, revoke:false};
  const blob = await assetBlob(asset, original);
  return blob ? {url:URL.createObjectURL(blob), revoke:true} : {url:'', revoke:false};
}
export const dataURL = (blob: Blob): Promise<string> => new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(blob); });
export async function visionImages(assets: Asset[]): Promise<string[]> {
  const result:string[]=[];
  for (const asset of assets.slice(0,6)) { const blob=await assetBlob(asset); if(blob) result.push(await dataURL((await imageBlob(blob,640)).blob)); }
  return result;
}
