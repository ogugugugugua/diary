import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdirSync, realpathSync } from 'node:fs';
import { open, realpath, readdir, stat, rename, unlink, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve, join, relative, sep, extname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Trip, Asset } from '../src/types';
import { validateTrip } from '../src/domain';

export const keyPattern = /^[A-Za-z0-9:_-]{1,220}$/;
const mediaTypes: Record<string, string> = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif','.heic':'image/heic','.heif':'image/heif','.mp4':'video/mp4','.mov':'video/quicktime','.m4v':'video/mp4','.webm':'video/webm'};
const stamp = (s: {size:number;mtimeMs:number}) => `${s.size}:${s.mtimeMs}`;
const inside = (root:string,path:string) => path === root || path.startsWith(root + sep);
export interface MediaRecord {
  id:string; rootId?:string; path:string; name:string; kind:'image'|'video'; mime:string; size:number;
  version:string; stamp:string; width:number; height:number; date:string; location:string;
  account?:string; fileId?:number; hash?:string;
}
export interface BlobRecord {key:string; file:string; hash:string; size:number; mime:string; category:'original'|'retained'|'cache'; touched:number;}
export interface ScanJob {id:string;rootId:string;status:'running'|'complete'|'cancelled'|'failed';count:number;error?:string;}
export class LibraryError extends Error { constructor(message:string,public status=400){super(message);} }

export class MediaLibrary {
  readonly db:DatabaseSync;
  readonly directory:string;
  readonly jobs = new Map<string,ScanJob>();
  private leases=new Map<string,{key:string;expires:number}>();
  private activeUploads = new Set<string>();
  constructor(directory = process.env.TRAVEL_DATA_DIR || join(homedir(),'行迹资料库')) {
    mkdirSync(resolve(directory),{recursive:true});this.directory=realpathSync(resolve(directory));mkdirSync(join(this.directory,'objects'),{recursive:true});mkdirSync(join(this.directory,'temporary'),{recursive:true});
    this.db=new DatabaseSync(join(this.directory,'library.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,json TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,root_id TEXT,path TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(root_id,path));
      CREATE INDEX IF NOT EXISTS media_root ON media(root_id);
      CREATE TABLE IF NOT EXISTS blobs(key TEXT PRIMARY KEY,file TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,category TEXT NOT NULL,touched INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS blobs_file ON blobs(file);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,json TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy(id TEXT PRIMARY KEY,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_legacy(key TEXT PRIMARY KEY,source_id TEXT NOT NULL,version TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL);
    `);
    if(!this.getMeta('libraryId'))this.setMeta('libraryId',randomUUID());
  }
  close(){this.db.close();}
  getMeta<T>(key:string):T|undefined {const row=this.db.prepare('SELECT json FROM meta WHERE key=?').get(key) as {json:string}|undefined;return row?JSON.parse(row.json):undefined;}
  setMeta(key:string,value:unknown){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));}
  trips():Trip[]{return (this.db.prepare('SELECT json,revision FROM projects ORDER BY updated DESC').all() as {json:string;revision:number}[]).map(r=>({...JSON.parse(r.json),storageRevision:r.revision}));}
  trip(id:string):Trip|undefined {const row=this.db.prepare('SELECT json,revision FROM projects WHERE id=?').get(id) as {json:string;revision:number}|undefined;return row?{...JSON.parse(row.json),storageRevision:row.revision}:undefined;}
  saveTrip(input:unknown,expected?:number):Trip {
    const trip=validateTrip(input);let revision=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.trip(trip.id);if(expected!==undefined&&expected!==(old?.storageRevision||0))throw new LibraryError('另一窗口已更新或删除这本游记，请先下载文字备份，再刷新读取最新版本。',409);revision=(old?.storageRevision||0)+1;
      if(old&&JSON.stringify({...old,storageRevision:undefined})!==JSON.stringify(trip)){
        const latest=this.db.prepare('SELECT created FROM versions WHERE project_id=? ORDER BY created DESC LIMIT 1').get(trip.id) as {created:number}|undefined;
        if(!latest||Date.now()-latest.created>60000){this.db.prepare('INSERT INTO versions VALUES(?,?,?,?)').run(randomUUID(),trip.id,JSON.stringify(old),Date.now());this.db.prepare('DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY created DESC LIMIT 20)').run(trip.id,trip.id);}
      }
      this.db.prepare('INSERT INTO projects VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,revision=excluded.revision,updated=excluded.updated').run(trip.id,JSON.stringify(trip),revision,trip.updatedAt);
      const used=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]);
      for(const asset of trip.assets)if(used.has(asset.id)&&asset.source&&asset.source.kind!=='legacy'){
        this.db.prepare("UPDATE blobs SET category='retained' WHERE key=?").run(this.previewKey(asset.source.id,asset.source.version,'print'));
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return {...trip,storageRevision:revision};
  }
  deleteTrip(id:string){this.db.prepare('DELETE FROM projects WHERE id=?').run(id);this.db.prepare('DELETE FROM versions WHERE project_id=?').run(id);this.db.prepare("INSERT INTO legacy VALUES(?,'deleted') ON CONFLICT(id) DO UPDATE SET status='deleted'").run(id);}
  history(id:string){return (this.db.prepare('SELECT id,json,created FROM versions WHERE project_id=? ORDER BY created DESC').all(id) as {id:string;json:string;created:number}[]).map(r=>({id:r.id,created:r.created,trip:JSON.parse(r.json) as Trip}));}
  bridgeLegacy(input:unknown):Trip|undefined {const trip=validateTrip(input);if(this.db.prepare('SELECT id FROM legacy WHERE id=?').get(trip.id))return this.trip(trip.id);const result=this.trip(trip.id)||this.saveTrip(trip);this.db.prepare("INSERT INTO legacy VALUES(?,'migrated')").run(trip.id);return result;}
  legacyDone(){return (this.db.prepare('SELECT id FROM legacy').all() as {id:string}[]).map(r=>r.id);}
  roots(){return this.db.prepare('SELECT id,path,name FROM roots ORDER BY name').all() as {id:string;path:string;name:string}[];}
  root(id:string){const root=this.db.prepare('SELECT id,path,name FROM roots WHERE id=?').get(id) as {id:string;path:string;name:string}|undefined;if(!root)throw new LibraryError('素材目录未登记。',404);return root;}
  async registerRoot(path:string){if(typeof path!=='string'||!path.trim()||path.length>3000)throw new LibraryError('请填写电脑上的素材目录路径。');const canonical=await realpath(resolve(path.trim())).catch(()=>{throw new LibraryError('找不到这个目录，请检查路径和硬盘连接。');});if(!(await stat(canonical)).isDirectory())throw new LibraryError('请选择文件夹。');if(inside(this.directory,canonical))throw new LibraryError('资料库内部文件不需要重复登记。');let root=this.roots().find(r=>r.path===canonical);if(!root){root={id:randomUUID(),path:canonical,name:basename(canonical)};this.db.prepare('INSERT INTO roots VALUES(?,?,?)').run(root.id,root.path,root.name);}return root;}
  async relinkRoot(id:string,path:string){const root=this.root(id),canonical=await realpath(resolve(path.trim()));if(!(await stat(canonical)).isDirectory())throw new LibraryError('新位置不是文件夹。');this.db.prepare('UPDATE roots SET path=? WHERE id=?').run(canonical,id);return {...root,path:canonical};}
  async file(record:MediaRecord,version?:string):Promise<string>{
    if(!record.rootId)throw new LibraryError('请先准备网盘原文件。',409);
    const root=this.root(record.rootId),file=resolve(root.path,record.path);
    const canonical=await realpath(file).catch(()=>{throw new LibraryError('原文件暂不可用，请连接硬盘或重新关联目录。',404);});
    if(!inside(root.path,canonical))throw new LibraryError('这个文件已经离开登记目录，请重新关联。',403);
    const info=await stat(canonical);if(!info.isFile())throw new LibraryError('原文件暂不可用。',404);
    if((version&&record.version!==version)||stamp(info)!==record.stamp)throw new LibraryError('原文件发生变化，请核对后重新关联；已保存的游记画面仍然保留。',409);
    return canonical;
  }
  record(id:string){const row=this.db.prepare('SELECT json FROM media WHERE id=?').get(id) as {json:string}|undefined;if(!row)throw new LibraryError('素材引用不存在，请重新关联。',404);return JSON.parse(row.json) as MediaRecord;}
  storeRecord(record:MediaRecord){this.db.prepare('INSERT INTO media VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET root_id=excluded.root_id,path=excluded.path,json=excluded.json').run(record.id,record.rootId||null,record.path,JSON.stringify(record));}
  media(rootId?:string,offset=0,limit=500){const rows=(rootId?this.db.prepare('SELECT json FROM media WHERE root_id=? ORDER BY path LIMIT ? OFFSET ?').all(rootId,limit,offset):this.db.prepare('SELECT json FROM media ORDER BY path LIMIT ? OFFSET ?').all(limit,offset)) as {json:string}[];return rows.map(r=>JSON.parse(r.json) as MediaRecord);}
  asAsset(record:MediaRecord):Asset {return {id:randomUUID(),name:record.name,kind:record.kind,size:record.size,width:record.width,height:record.height,date:record.date,location:record.location,caption:'',selected:false,fingerprint:`ref:${record.id}:${record.version}`,source:{kind:record.rootId?'local':'baidu',id:record.id,version:record.version,path:record.path,rootName:record.rootId?this.root(record.rootId).name:'百度网盘'}};}
  async referenceFile(rootId:string,path:string,mime?:string){const root=this.root(rootId),file=await realpath(resolve(root.path,path));if(!inside(root.path,file))throw new LibraryError('文件不在登记目录内。',403);const info=await stat(file);if(!info.isFile())throw new LibraryError('不是素材文件。');const type=mime||mediaTypes[extname(path).toLowerCase()];if(!type)throw new LibraryError('文件格式不支持。');const existing=this.db.prepare('SELECT json FROM media WHERE root_id=? AND path=?').get(rootId,path) as {json:string}|undefined;const old=existing?JSON.parse(existing.json) as MediaRecord:undefined;
    if(old&&old.stamp===stamp(info))return old;
    const record:MediaRecord={id:old?.id||randomUUID(),rootId,path,name:basename(path),kind:type.startsWith('video/')?'video':'image',mime:type,size:info.size,stamp:stamp(info),version:randomUUID(),width:0,height:0,date:'',location:''};
    if(record.kind==='image')try{const handle=await open(file,'r');let bytes:Buffer;try{bytes=Buffer.alloc(Math.min(info.size,262144));const read=await handle.read(bytes,0,bytes.length,0);bytes=bytes.subarray(0,read.bytesRead);}finally{await handle.close();}const exifr=(await import('exifr')).default;const metadata=await exifr.parse(bytes,['DateTimeOriginal','CreateDate','ExifImageWidth','ExifImageHeight','ImageWidth','ImageHeight','latitude','longitude']);const date=metadata?.DateTimeOriginal||metadata?.CreateDate;if(date instanceof Date&&!Number.isNaN(date.getTime()))record.date=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;record.width=Number(metadata?.ExifImageWidth||metadata?.ImageWidth)||0;record.height=Number(metadata?.ExifImageHeight||metadata?.ImageHeight)||0;if(typeof metadata?.latitude==='number'&&typeof metadata?.longitude==='number')record.location=`${metadata.latitude.toFixed(4)}, ${metadata.longitude.toFixed(4)}`;}catch{/* Missing EXIF does not prevent a reference. */}
    this.storeRecord(record);return record;
  }
  scan(rootId:string){const active=[...this.jobs.values()].find(j=>j.rootId===rootId&&j.status==='running');if(active)return active;const job:ScanJob={id:randomUUID(),rootId,status:'running',count:0};this.jobs.set(job.id,job);void this.scanDirectory(job);return job;}
  private async scanDirectory(job:ScanJob){try{const root=this.root(job.rootId),pending=[''];while(pending.length&&job.status==='running'){const directory=pending.pop()!;for(const entry of await readdir(join(root.path,directory),{withFileTypes:true})){if(job.status!=='running')break;if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const path=join(directory,entry.name),absolute=resolve(root.path,path);if(inside(this.directory,absolute))continue;if(entry.isDirectory())pending.push(path);else if(entry.isFile()&&mediaTypes[extname(entry.name).toLowerCase()]){await this.referenceFile(root.id,path);job.count++;}}}if(job.status==='running')job.status='complete';}catch(error){job.status='failed';job.error=error instanceof Error?error.message:'目录读取失败。';}}
  blob(key:string){return this.db.prepare('SELECT * FROM blobs WHERE key=?').get(key) as unknown as BlobRecord|undefined;}
  touch(key:string){this.db.prepare('UPDATE blobs SET touched=? WHERE key=?').run(Date.now(),key);}
  previewKey(id:string,version:string,quality:string){return `${quality==='print'?'print':'preview'}-${id}-${version}`;}
  cacheLimit(){return this.getMeta<number>('cacheLimitBytes')||5*1024**3;}
  async storeBlob(key:string,input:Readable,mime:string,category:BlobRecord['category'],maximum=2*1024**4){
    if(!keyPattern.test(key))throw new LibraryError('素材编号不正确。');
    const temporary=join(this.directory,'temporary',randomUUID()),hash=createHash('sha256');let size=0;this.activeUploads.add(temporary);
    try{const meter=new Transform({transform(chunk:Buffer,_encoding,callback){size+=chunk.length;if(size>maximum){callback(new LibraryError('文件超过本次处理的容量限制。',413));return;}hash.update(chunk);callback(null,chunk);}});await pipeline(input,meter,createWriteStream(temporary));
      if(category==='cache'&&size>this.cacheLimit())throw new LibraryError('文件超过缓存预算，请增加预算或下载到电脑后引用。',413);
      const digest=hash.digest('hex'),file=join(this.directory,'objects',digest);try{const existing=await stat(file);if(existing.size===size&&await this.hashFile(file)===digest)await unlink(temporary);else await rename(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')await rename(temporary,file);else throw error;}
      const old=this.blob(key);const actual=old?.category==='retained'&&category==='cache'?'retained':category;
      this.db.prepare('INSERT INTO blobs VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET file=excluded.file,hash=excluded.hash,size=excluded.size,mime=excluded.mime,category=excluded.category,touched=excluded.touched').run(key,file,digest,size,mime,actual,Date.now());
      if(old&&old.file!==file)await this.removeUnreferencedFile(old.file);
      await this.enforceBudget(key);if(actual==='cache'&&this.cacheBytes()>this.cacheLimit()){await this.removeBlob(key);throw new LibraryError('正在使用的缓存占满预算，请关闭其他素材详情或增加缓存预算。',413);}return this.blob(key)!;
    }finally{this.activeUploads.delete(temporary);await unlink(temporary).catch(()=>{});}
  }
  private async removeUnreferencedFile(file:string){if(!this.db.prepare('SELECT key FROM blobs WHERE file=? LIMIT 1').get(file))await unlink(file).catch(()=>{});}
  async removeBlob(key:string){const old=this.blob(key);if(!old)return;this.db.prepare('DELETE FROM blobs WHERE key=?').run(key);await this.removeUnreferencedFile(old.file);}
  acquireLease(key:string,lease:string){if(!keyPattern.test(lease))throw new LibraryError('播放会话编号不正确。');this.leases.set(lease,{key,expires:Date.now()+120000});}
  releaseLease(key:string,lease:string){if(this.leases.get(lease)?.key===key)this.leases.delete(lease);}
  protectedKeys(){const keys=new Set<string>();for(const [id,lease]of this.leases){if(lease.expires<Date.now())this.leases.delete(id);else keys.add(lease.key);}const current=this.trips(),versions=(this.db.prepare('SELECT json FROM versions').all() as {json:string}[]).map(r=>JSON.parse(r.json) as Trip);for(const trip of [...current,...versions]){const used=new Set([trip.coverId,...trip.chapters.flatMap(c=>c.assetIds)]);for(const asset of trip.assets){if(current.includes(trip)&&asset.blobKey)keys.add(asset.blobKey);if(asset.thumbnailKey)keys.add(asset.thumbnailKey);if(used.has(asset.id)&&asset.source&&asset.source.kind!=='legacy')keys.add(this.previewKey(asset.source.id,asset.source.version,'print'));}for(const memory of trip.memories)if(memory.audioKey)keys.add(memory.audioKey);}return keys;}
  async enforceBudget(except?:string){let bytes=this.cacheBytes();if(bytes<=this.cacheLimit())return;const protectedKeys=this.protectedKeys();for(const blob of this.db.prepare("SELECT * FROM blobs WHERE category='cache' ORDER BY touched") .all() as unknown as BlobRecord[]){if(bytes<=this.cacheLimit())break;if(blob.key===except||protectedKeys.has(blob.key))continue;await this.removeBlob(blob.key);bytes=this.cacheBytes();}}
  private cacheBytes(){return (this.db.prepare("SELECT COALESCE(SUM(size),0) AS size FROM (SELECT file,MAX(size) AS size,MAX(CASE category WHEN 'original' THEN 3 WHEN 'retained' THEN 2 ELSE 1 END) AS priority FROM blobs GROUP BY file) WHERE priority=1").get() as {size:number}).size;}
  async clearCache(){const protectedKeys=this.protectedKeys();for(const blob of this.db.prepare("SELECT key FROM blobs WHERE category='cache'").all() as {key:string}[])if(!protectedKeys.has(blob.key))await this.removeBlob(blob.key);return this.space();}
  async clearUnused(){const protectedKeys=this.protectedKeys();for(const blob of this.db.prepare("SELECT key FROM blobs WHERE category!='cache'").all() as {key:string}[])if(!protectedKeys.has(blob.key))await this.removeBlob(blob.key);return this.space();}
  space(){const objects=this.db.prepare('SELECT file,size,category FROM blobs').all() as unknown as Pick<BlobRecord,'file'|'size'|'category'>[];const grouped=new Map<string,{size:number;category:BlobRecord['category']}>();for(const object of objects){const existing=grouped.get(object.file);if(!existing||existing.category==='cache'||(existing.category==='retained'&&object.category==='original'))grouped.set(object.file,object);}const sizes={original:0,retained:0,cache:0};for(const object of grouped.values())sizes[object.category]+=object.size;const referenceBytes=(this.db.prepare("SELECT SUM(json_extract(json,'$.size')) AS size FROM media").get() as {size:number|null}).size||0;return {...sizes,referenceBytes,objects:grouped.size,cacheLimit:this.cacheLimit()};}
  async hashFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
  async verifyReference(record:MediaRecord,expected:string,size:number){const file=await this.file(record);if(record.size!==size)throw new LibraryError('新文件大小与原素材不同，未改变关联。');const hash=await this.hashFile(file);await this.file(record);if(hash!==expected)throw new LibraryError('新文件内容与原素材不同，未改变关联。');record.hash=hash;this.storeRecord(record);return record;}
  async verifyLegacy(key:string,record:MediaRecord,input:Readable,size:number){const hash=createHash('sha256');let total=0;for await(const chunk of input){total+=chunk.length;hash.update(chunk);if(total>size)throw new LibraryError('原素材大小不一致。');}if(total!==size)throw new LibraryError('原素材传输未完成。');const digest=hash.digest('hex');await this.verifyReference(record,digest,size);this.db.prepare('INSERT INTO verified_legacy VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source_id=excluded.source_id,version=excluded.version,hash=excluded.hash,size=excluded.size').run(key,record.id,record.version,digest,size);return record;}
  async legacyKeySafe(key:string,size:number){const blob=this.blob(key);if(blob&&blob.category!=='cache'&&blob.size===size){try{return (await stat(blob.file)).size===size&&await this.hashFile(blob.file)===blob.hash;}catch{return false;}}const proof=this.db.prepare('SELECT source_id,version,hash,size FROM verified_legacy WHERE key=?').get(key) as {source_id:string;version:string;hash:string;size:number}|undefined;if(!proof||proof.size!==size)return false;try{const record=this.record(proof.source_id),file=await this.file(record,proof.version);return record.hash===proof.hash&&await this.hashFile(file)===proof.hash;}catch{return false;}}
  async registerBackupRoot(path:string){const canonical=await realpath(resolve(path));let root=this.roots().find(r=>r.path===canonical);if(!root){root={id:randomUUID(),name:'项目备份',path:canonical};this.db.prepare('INSERT INTO roots VALUES(?,?,?)').run(root.id,root.path,root.name);}return root;}
  async readPackageFile(root:string,path:string){if(!/^(media|audio)\/[A-Za-z0-9_-]+\.bin$/.test(path))throw new LibraryError('备份中的素材路径不正确。');const canonical=await realpath(resolve(root,path));if(!inside(root,canonical))throw new LibraryError('备份素材离开了备份目录。');return canonical;}
}
