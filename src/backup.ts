import { remapStops } from './itinerary';
import type JSZip from 'jszip';
import { getBlob } from './db';
import { assetBlob } from './media';
import { download, safeName } from './export';
import { id, now, validateTrip } from './domain';
import type { Trip } from './types';
interface Entry{assetId?:string;memoryId?:string;kind:'original'|'thumbnail'|'audio';path:string;mime:string;}
export function lightweightBackup(trip:Trip):Blob{
  const blob=new Blob([JSON.stringify({format:'xingji',version:1,trip:validateTrip(trip)},null,2)],{type:'application/json'});
  if(blob.size>5*1024**2)throw new Error('项目文字与素材信息超过5 MB，请拆分为多本游记后备份。');
  return blob;
}
export async function backupProject(trip:Trip,complete:boolean,progress?:(text:string)=>void):Promise<void>{
  if(!complete){download(lightweightBackup(trip),`${safeName(trip.title)}.xingji.json`);return;}
  if(trip.assets.reduce((size,asset)=>size+asset.size,0)>950*1024**2)throw new Error('完整项目较大，请先使用轻量备份，并保留原始素材。完整备份暂限1 GB。');
  const Zip=(await import('jszip')).default,zip=new Zip(),files:Entry[]=[];let totalBytes=0;
  const countBlob=(blob:Blob)=>{totalBytes+=blob.size;if(totalBytes>950*1024**2)throw new Error('原文件与录音超过完整备份容量，请使用轻量备份并保留原始素材。');};
  for(let index=0;index<trip.assets.length;index++){
    const asset=trip.assets[index];progress?.(`正在备份素材 ${index+1} / ${trip.assets.length}`);
    for(const kind of ['original','thumbnail'] as const){
      const blob=kind==='original'?await assetBlob(asset,true):await assetBlob(asset);
      if(!blob){if(kind==='original')throw new Error(`「${asset.name}」的原文件缺失，请先重新关联或使用轻量备份。`);continue;}
      countBlob(blob);
      const path=`media/${asset.id}-${kind}.bin`;zip.file(path,await blob.arrayBuffer());files.push({assetId:asset.id,kind,path,mime:blob.type});
    }
  }
  for(const memory of trip.memories)if(memory.audioKey){const blob=await getBlob(memory.audioKey);if(!blob)throw new Error('项目的一段原始录音缺失，请先恢复录音或使用轻量备份。');countBlob(blob);const path=`audio/${memory.id}.bin`;zip.file(path,await blob.arrayBuffer());files.push({memoryId:memory.id,kind:'audio',path,mime:blob.type});}
  const manifest=JSON.stringify({format:'xingji',version:1,trip:validateTrip(trip),files});if(new Blob([manifest]).size>5*1024**2)throw new Error('项目清单超过5 MB，请拆分为多本游记后备份。');
  zip.file('project.json',manifest);
  progress?.('正在打包项目');const output=await zip.generateAsync({type:'blob',compression:'STORE'});
  download(output,`${safeName(trip.title)}.xingji.zip`);
}
export async function restoreProject(file:File):Promise<{trip:Trip;blobs:{key:string;blob:Blob}[]}>{
  if(file.size>1024**3)throw new Error('备份超过1 GB，请使用轻量项目文件恢复后重新关联素材。');
  let data:Record<string,unknown>,zip:JSZip|undefined;
  const magic=new Uint8Array(await file.slice(0,4).arrayBuffer());
  if(magic[0]===80&&magic[1]===75){const Zip=(await import('jszip')).default;zip=await Zip.loadAsync(await file.arrayBuffer());const manifest=zip.file('project.json');
    if(!manifest)throw new Error('备份中没有项目清单。');
    const info=manifest as unknown as {_data?:{uncompressedSize?:number}};if((info._data?.uncompressedSize||0)>5*1024**2)throw new Error('项目清单过大。');
    data=JSON.parse(await manifest.async('string'));
  }else{if(file.size>5*1024**2)throw new Error('轻量项目文件过大。');data=JSON.parse(await file.text());}
  if(data.format!=='xingji'||data.version!==1)throw new Error('不支持这个项目版本。');
  const trip=validateTrip(data.trip),oldAssets=new Map(trip.assets.map(a=>[a.id,id()])),oldMemories=new Map(trip.memories.map(m=>[m.id,id()]));
  const blobs:{key:string;blob:Blob}[]=[],originals=new Map<string,string>(),thumbnails=new Map<string,string>(),audios=new Map<string,string>();
  if(zip&&Array.isArray(data.files)){
    let total=0;
    if(data.files.length>50000)throw new Error('备份中的素材条目超过5万个，请拆分项目。');
    for(const entry of data.files as Entry[]){
      if(!entry||typeof entry.path!=='string'||! /^(media|audio)\/[a-zA-Z0-9_-]+(?:-(original|thumbnail))?\.bin$/.test(entry.path))throw new Error('备份中的素材路径不正确。');
      const target=entry.assetId?oldAssets.get(entry.assetId):entry.memoryId?oldMemories.get(entry.memoryId):undefined;if(!target)continue;
      const item=zip.file(entry.path);if(!item)continue;
      const info=item as unknown as {_data?:{uncompressedSize?:number}};total+=info._data?.uncompressedSize||0;if(total>1024**3)throw new Error('备份解压后的素材超过1 GB。');
      const bytes=await item.async('uint8array');const key=`${entry.kind==='original'?'media':entry.kind==='thumbnail'?'thumb':'audio'}-${target}`;
      blobs.push({key,blob:new Blob([new Uint8Array(bytes)],{type:typeof entry.mime==='string'?entry.mime:'application/octet-stream'})});
      if(entry.kind==='original'&&entry.assetId)originals.set(entry.assetId,key);else if(entry.kind==='thumbnail'&&entry.assetId)thumbnails.set(entry.assetId,key);else if(entry.kind==='audio'&&entry.memoryId)audios.set(entry.memoryId,key);
    }
  }
  trip.id=id();trip.demo=false;trip.updatedAt=now();trip.coverId=oldAssets.get(trip.coverId||'');
  trip.assets=trip.assets.map(a=>({...a,id:oldAssets.get(a.id)!,blobKey:originals.get(a.id),thumbnailKey:thumbnails.get(a.id),source:undefined,src:undefined,missing:!originals.has(a.id)&&!thumbnails.has(a.id)}));
  trip.memories=trip.memories.map(m=>({...m,id:oldMemories.get(m.id)!,audioKey:audios.get(m.id),assetId:oldAssets.get(m.assetId||'')}));
  remapStops(trip,oldAssets);
  trip.chapters=trip.chapters.map(c=>({...c,id:id(),assetIds:c.assetIds.map(a=>oldAssets.get(a)!).filter(Boolean)}));
  return {trip,blobs};
}
