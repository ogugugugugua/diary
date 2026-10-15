import { remapStops } from '../src/itinerary';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, rename, writeFile, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MediaLibrary, LibraryError } from './library';
import { validateTrip } from '../src/domain';
import type { Trip, Asset } from '../src/types';

interface Entry { assetId?:string;memoryId?:string;kind:'original'|'thumbnail'|'audio';path:string;mime:string;size:number;hash:string; }
export interface ExportJob {id:string;status:'running'|'complete'|'failed';directory:string;done:number;total:number;bytes:number;error?:string;}
export type RemoteOriginal=(asset:Asset)=>Promise<{stream:Readable;mime:string;size:number}>;
export function startFolderExport(library:MediaLibrary,trip:Trip,originals:boolean,destination?:string,remoteOriginal?:RemoteOriginal):ExportJob {
  const job:ExportJob={id:randomUUID(),status:'running',directory:'',done:0,total:0,bytes:0};
  void exportFolder(library,structuredClone(trip),originals,destination,job,remoteOriginal);return job;
}
async function exportFolder(library:MediaLibrary,trip:Trip,originals:boolean,destination:string|undefined,job:ExportJob,remoteOriginal?:RemoteOriginal){
  const entries:Entry[]=[],used=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]);
  const assets=trip.assets.filter(a=>used.has(a.id));job.total=assets.length+(originals?assets.length:0)+trip.memories.filter(m=>m.audioKey).length;
  try{
    const base=destination?await realpath(resolve(destination)):join(library.directory,'exports');await mkdir(base,{recursive:true});
    const folder=join(base,`xingji-${new Date().toISOString().replace(/[:.]/g,'-')}-${job.id.slice(0,8)}`);await mkdir(folder);job.directory=folder;await mkdir(join(folder,'media'));await mkdir(join(folder,'audio'));
    const copy=async(file:string|Readable,path:string,mime:string,kind:Entry['kind'],assetId?:string,memoryId?:string,expectedSize?:number)=>{
      const hash=createHash('sha256');let size=0;const temporary=join(folder,path+'.partial');
      try{await pipeline(typeof file==='string'?createReadStream(file):file,new Transform({transform(chunk:Buffer,_encoding,callback){hash.update(chunk);size+=chunk.length;job.bytes+=chunk.length;callback(null,chunk);}}),createWriteStream(temporary));if(expectedSize!==undefined&&size!==expectedSize)throw new LibraryError('原件传输未完成，备份未标记为有效。');await rename(temporary,join(folder,path));entries.push({assetId,memoryId,kind,path,mime,size,hash:hash.digest('hex')});job.done++;}catch(error){await unlink(temporary).catch(()=>{});throw error;}
    };
    for(const asset of assets){
      let picture=asset.thumbnailKey?library.blob(asset.thumbnailKey):undefined;
      if(!picture&&asset.source&&asset.source.kind!=='legacy')picture=library.blob(library.previewKey(asset.source.id,asset.source.version,'print'));
      if(!picture)throw new LibraryError(`「${asset.name}」尚未保存打印画面，请先打开或准备这张配图。`);
      await copy(picture.file,`media/${asset.id}-thumbnail.bin`,picture.mime,'thumbnail',asset.id);
      if(originals){
        if(asset.source?.kind==='local'){const record=library.record(asset.source.id),file=await library.file(record,asset.source.version);await copy(file,`media/${asset.id}-original.bin`,record.mime,'original',asset.id);await library.file(record,asset.source.version);}
        else if(asset.source?.kind==='baidu'&&remoteOriginal){const remote=await remoteOriginal(asset);await copy(remote.stream,`media/${asset.id}-original.bin`,remote.mime,'original',asset.id,undefined,remote.size);}
        else{const blob=asset.blobKey?library.blob(asset.blobKey):asset.source?.kind==='baidu'?library.blob(`remote-${asset.source.id}-${asset.source.version}`):undefined;if(!blob)throw new LibraryError(`「${asset.name}」的原件尚未准备，请先迁移或重新关联。`);await copy(blob.file,`media/${asset.id}-original.bin`,blob.mime,'original',asset.id);}
      }
    }
    for(const memory of trip.memories)if(memory.audioKey){const blob=library.blob(memory.audioKey);if(!blob)throw new LibraryError('一段原始录音未迁移，请先保存录音。');await copy(blob.file,`audio/${memory.id}.bin`,blob.mime,'audio',undefined,memory.id);}
    const manifest={format:'xingji',version:2,originals,trip:validateTrip(trip),files:entries};
    await writeFile(join(folder,'project.json.partial'),JSON.stringify(manifest,null,2));await rename(join(folder,'project.json.partial'),join(folder,'project.json'));
    job.status='complete';
  }catch(error){job.status='failed';job.error=error instanceof LibraryError?error.message:'项目导出失败，请检查素材、磁盘空间或网盘连接。未完成的文件夹未标记为有效备份。';}
}

export async function restoreFolderPackage(library:MediaLibrary,directory:string):Promise<Trip>{
  const root=await realpath(resolve(directory.trim())),manifestPath=join(root,'project.json');if((await stat(manifestPath)).size>16*1024**2)throw new LibraryError('项目清单超过16 MB。');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {format?:string;version?:number;trip:unknown;files:Entry[]};
  if(manifest.format!=='xingji'||manifest.version!==2||!Array.isArray(manifest.files)||manifest.files.length>50000)throw new LibraryError('项目文件夹格式不支持。');
  const trip=validateTrip(manifest.trip),assetIds=new Map(trip.assets.map(a=>[a.id,randomUUID()])),memoryIds=new Map(trip.memories.map(m=>[m.id,randomUUID()]));
  const originals=new Map<string,Asset['source']>(),thumbnails=new Map<string,string>(),audios=new Map<string,string>();const rootRecord=await library.registerBackupRoot(root),seen=new Set<string>();
  for(const entry of manifest.files){
    if(!['original','thumbnail','audio'].includes(entry.kind)||!Number.isSafeInteger(entry.size)||entry.size<0||!/^[0-9a-f]{64}$/.test(entry.hash)||seen.has(entry.path))throw new LibraryError('备份清单中的素材信息无效或重复。');seen.add(entry.path);
    const file=await library.readPackageFile(root,entry.path);if((await stat(file)).size!==entry.size)throw new LibraryError('备份中的素材大小不一致。');
    if(await library.hashFile(file)!==entry.hash)throw new LibraryError('备份中的素材校验失败，未恢复项目。');
    if(entry.kind==='original'&&entry.assetId&&assetIds.has(entry.assetId)){const record=await library.referenceFile(rootRecord.id,entry.path,entry.mime);record.hash=entry.hash;library.storeRecord(record);originals.set(entry.assetId,{kind:'local',id:record.id,version:record.version,path:record.path,rootName:'项目备份'});}
    else if(entry.kind==='thumbnail'&&entry.assetId&&assetIds.has(entry.assetId)){const key=`restored-thumb-${assetIds.get(entry.assetId)}`;await library.storeBlob(key,createReadStream(file),entry.mime,'retained');thumbnails.set(entry.assetId,key);}
    else if(entry.kind==='audio'&&entry.memoryId&&memoryIds.has(entry.memoryId)){const key=`restored-audio-${memoryIds.get(entry.memoryId)}`;await library.storeBlob(key,createReadStream(file),entry.mime,'retained');audios.set(entry.memoryId,key);}
  }
  trip.id=randomUUID();trip.demo=false;trip.updatedAt=new Date().toISOString();trip.coverId=assetIds.get(trip.coverId||'');
  trip.assets=trip.assets.map(a=>({...a,id:assetIds.get(a.id)!,source:originals.get(a.id)||a.source,blobKey:undefined,src:undefined,thumbnailKey:thumbnails.get(a.id),missing:!thumbnails.has(a.id)&&!originals.has(a.id)}));
  trip.memories=trip.memories.map(m=>({...m,id:memoryIds.get(m.id)!,assetId:assetIds.get(m.assetId||''),audioKey:audios.get(m.id)}));
  remapStops(trip,assetIds);
  trip.chapters=trip.chapters.map(c=>({...c,id:randomUUID(),assetIds:c.assetIds.map(id=>assetIds.get(id)!).filter(Boolean)}));
  return library.saveTrip(trip);
}
