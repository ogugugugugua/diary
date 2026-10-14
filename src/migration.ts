import * as legacy from './legacy-db';
import { listTrips } from './db';
import { nativeRequest, nativeBlobInfo, putNativeBlob, type LibraryState } from './native';
import type { Trip } from './types';
export async function legacyTrips(){try{return (await legacy.listTrips()).filter(t=>!t.demo);}catch{return [];}}
export async function migrateBrowserProjects(originals:boolean,progress:(text:string)=>void){
  const projects=await legacyTrips(),state=await nativeRequest<LibraryState>('/state');let copied=0;
  const estimate=originals?projects.reduce((n,t)=>n+t.assets.reduce((sum,a)=>sum+a.size,0),0):0;
  if(estimate>state.freeBytes)throw new Error('迁移原件需要的空间超过剩余空间；请先迁移正文与画面，再引用原素材目录。');
  for(const project of projects){
    const used=new Set([project.coverId,...project.chapters.flatMap(c=>c.assetIds)]);
    for(const asset of project.assets){progress(`正在迁移「${project.title}」：${asset.name}`);
      const keys=[...(asset.thumbnailKey?[{key:asset.thumbnailKey,category:'retained' as const}]:[]),...(originals&&asset.blobKey?[{key:asset.blobKey,category:'original' as const}]:[])];
      for(const item of keys){const blob=await legacy.getBlob(item.key);if(!blob)throw new Error(`「${asset.name}」的一份旧素材缺失，未清理旧项目。`);await putNativeBlob(item.key,blob,item.category);copied+=blob.size;}
    }
    for(const memory of project.memories)if(memory.audioKey){const blob=await legacy.getBlob(memory.audioKey);if(!blob)throw new Error('旧项目录音缺失，未清理旧数据。');await putNativeBlob(memory.audioKey,blob,'retained');copied+=blob.size;}
    const migrated={...project,assets:project.assets.map(asset=>asset.src?asset:{...asset,source:asset.source||{kind:'legacy' as const,id:asset.id,version:'legacy',rootName:'旧浏览器项目'}})};
    await nativeRequest('/legacy/bridge',{trip:migrated});
  }
  const settings=await legacy.getMeta('settings');if(settings&&!(await nativeRequest<{value?:unknown}>('/meta?key=settings')).value)await nativeRequest('/meta',{key:'settings',value:settings});
  return {projects:projects.length,bytes:copied,trips:await listTrips()};
}
export async function clearMigratedBrowserProjects(progress:(text:string)=>void){
  const projects=await legacyTrips(),native=await listTrips();let removed=0;
  for(const project of projects){
    if(!native.some(t=>t.id===project.id))continue;
    const entries:{key:string;size:number}[]=[];
    for(const asset of project.assets){for(const key of [asset.blobKey,asset.thumbnailKey])if(key){const blob=await legacy.getBlob(key);if(blob)entries.push({key,size:blob.size});}}
    for(const memory of project.memories)if(memory.audioKey){const blob=await legacy.getBlob(memory.audioKey);if(blob)entries.push({key:memory.audioKey,size:blob.size});}
    progress(`正在核对旧副本：${project.title}`);const {safe}=await nativeRequest<{safe:string[]}>('/legacy/check',{entries});
    if(entries.some(e=>!safe.includes(e.key)))throw new Error(`「${project.title}」仍有原件或画面未可靠迁移；旧浏览器数据已保留。请先完整迁移，或核验并重新关联原件。`);
    await legacy.deleteTrip(project);removed++;
  }
  return removed;
}
export async function verifyAndRelinkAsset(trip:Trip,assetId:string,sourceId:string,replace=false){
  const asset=trip.assets.find(a=>a.id===assetId);if(!asset)throw new Error('原素材不存在。');
  const info=asset.blobKey?await nativeBlobInfo(asset.blobKey):undefined;
  if(!replace&&asset.source?.kind==='legacy'&&asset.blobKey&&!info){const original=await legacy.getBlob(asset.blobKey);if(!original)throw new Error('当前浏览器中没有旧原件，请恢复完整备份后再核验。');const response=await fetch('/api/library/verify/'+sourceId,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Legacy-Key':asset.blobKey,'X-Source-Size':String(original.size)},body:original});const data=await response.json();if(!response.ok)throw new Error(data.error||'原素材核验失败。');return data.record as import('./native').NativeRecord;}
  return (await nativeRequest<{record:import('./native').NativeRecord}>('/relink',{tripId:trip.id,assetId,sourceId,replace})).record;
}
