import type { Asset, Trip } from './types';
export interface LibraryState {directory:string;libraryId:string;freeBytes:number;legacyDone:string[];roots:{id:string;path:string;name:string}[];space:{original:number;retained:number;cache:number;referenceBytes:number;objects:number;cacheLimit:number};}
export interface NativeRecord {id:string;version:string;rootId?:string;path:string;name:string;kind:'image'|'video';size:number;width:number;height:number;date:string;location:string;mime:string;hash?:string;}
export interface NativeJob {id:string;rootId:string;status:'running'|'complete'|'cancelled'|'failed';count:number;error?:string;}
export const isNativeStore=()=>typeof window!=='undefined'&&/^https?:$/.test(window.location.protocol);
export async function nativeRequest<T>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch('/api/library'+path,{method:method||(body===undefined?'GET':'POST'),headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'本地资料库操作失败。');return result as T;
}
export const blobURL=(key:string)=>'/api/library/blobs/'+encodeURIComponent(key);
export async function nativeBlobInfo(key:string){const response=await fetch(blobURL(key)+'?info=1');if(response.status===404)return undefined;const result=await response.json();if(!response.ok)throw new Error(result.error||'无法读取素材信息。');return result as {key:string;size:number;hash:string;category:string;mime:string};}
export async function putNativeBlob(key:string,blob:Blob,category:'original'|'retained'|'cache'='retained'){
  const response=await fetch(blobURL(key)+'?category='+category,{method:'POST',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});const result=await response.json();
  if(!response.ok)throw new Error(result.error||'素材保存失败。');if(result.size!==blob.size)throw new Error('素材传输未完成，旧数据已保留。');return result as {key:string;size:number;hash:string};
}
export const sourceURL=(asset:Asset,action='original',quality='thumb')=>`/api/library/media/${asset.source?.id}/${action}?version=${asset.source?.version}&quality=${quality}`;
let remoteSession='';
export async function connectRemote(token:string){const result=await nativeRequest<{session:string;account:string}>('/baidu/connect',{token});remoteSession=result.session;return result;}
export async function registerRemote(files:{id:number;name:string;path:string;size:number}[]){return nativeRequest<{assets:Asset[]}>('/baidu/register',{session:remoteSession,files});}
export async function prepareRemote(asset:Asset){if(!remoteSession)throw new Error('请先重新连接这个素材所属的百度网盘账号。');await nativeRequest(sourceURL(asset,'prepare').replace('/api/library',''),{session:remoteSession});window.dispatchEvent(new Event('xingji:media-refresh'));}
export async function releaseRemote(asset:Asset){if(asset.source?.kind==='baidu')await nativeRequest(sourceURL(asset,'release').replace('/api/library',''),{}).catch(()=>{});}
export function leaseRemote(asset:Asset){if(asset.source?.kind!=='baidu')return()=>{};const lease=crypto.randomUUID();const renew=()=>nativeRequest(sourceURL(asset,'lease').replace('/api/library',''),{lease}).catch(()=>{});void renew();const timer=setInterval(()=>void renew(),30000);return()=>{clearInterval(timer);void nativeRequest(sourceURL(asset,'release').replace('/api/library',''),{lease}).catch(()=>{});};}
export function refreshMedia(){window.dispatchEvent(new Event('xingji:media-refresh'));}
export async function referencedAssets(rootId:string,progress?:(text:string)=>void){const assets:Asset[]=[];let offset:number|null=0;while(offset!==null){const result:{assets:Asset[];next:number|null}=await nativeRequest(`/media?root=${rootId}&offset=${offset}&limit=1000`);assets.push(...result.assets);if(assets.length>20000)throw new Error('一个游记暂限2万个素材。请按旅行或年份分目录导入；已登记的索引仍会保留。');offset=result.next;progress?.(`已读取 ${assets.length} 个素材引用`);}return assets;}
export async function waitForScan(job:NativeJob,progress:(text:string)=>void,cancel?:()=>boolean){let current=job;while(current.status==='running'){if(cancel?.()){await nativeRequest('/scan/'+current.id,undefined,'DELETE');throw new Error('已停止扫描，已登记的素材保持可用。');}progress(`正在登记目录：${current.count} 个素材`);await new Promise(resolve=>setTimeout(resolve,300));current=(await nativeRequest<{job:NativeJob}>('/scan/'+current.id)).job;}if(current.status==='failed')throw new Error(current.error||'目录扫描失败。');return current;}
export async function exportFolder(trip:Trip,originals:boolean,progress:(text:string)=>void,destination?:string){let {job}=await nativeRequest<{job:{id:string;status:string;directory:string;done:number;total:number;bytes:number;error?:string}}>('/exports',{tripId:trip.id,originals,destination,session:remoteSession});while(job.status==='running'){progress(`正在导出 ${job.done} / ${job.total} 项，已写入 ${(job.bytes/1024**2).toFixed(1)} MB`);await new Promise(resolve=>setTimeout(resolve,400));job=(await nativeRequest<{job:typeof job}>('/exports/'+job.id)).job;}if(job.status!=='complete')throw new Error(job.error||'项目导出未完成。');return job.directory;}
