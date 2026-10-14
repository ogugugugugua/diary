import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, stat, readdir, symlink, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { MediaLibrary } from '../server/library';
import { createAppServer } from '../server/http';
import { createLibraryHandler } from '../server/library-http';
import { startFolderExport, restoreFolderPackage } from '../server/library-packages';
import { createTrip } from '../src/domain';

async function fixture(){const directory=await mkdtemp(join(tmpdir(),'xingji-test-')),library=new MediaLibrary(join(directory,'data'));await mkdir(join(directory,'source'));return {directory,library,source:join(directory,'source'),async close(){library.close();await rm(directory,{recursive:true,force:true});}};}
async function listen(server:ReturnType<typeof createServer>){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function closeServer(server:ReturnType<typeof createServer>){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
async function waitJob(job:{status:string;error?:string}){while(job.status==='running')await new Promise(resolve=>setTimeout(resolve,10));assert.equal(job.status,'complete',job.error);}

test('两个游记共享目录原件，删除一本不会复制或删除原件及另一本文档的画面',async()=>{const f=await fixture();try{
  await writeFile(join(f.source,'family.jpg'),'source-photo');const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'family.jpg');
  const one=createTrip('第一本'),two=createTrip('第二本');one.assets=[f.library.asAsset(record)];two.assets=[f.library.asAsset(record)];one.coverId=one.assets[0].id;two.coverId=two.assets[0].id;
  assert.notEqual(one.assets[0].id,two.assets[0].id);assert.equal(one.assets[0].source?.id,two.assets[0].source?.id);
  const key=f.library.previewKey(record.id,record.version,'print');await f.library.storeBlob(key,Readable.from(['print-picture']),'image/jpeg','retained');f.library.saveTrip(one);f.library.saveTrip(two);
  assert.equal(f.library.space().original,0);f.library.deleteTrip(one.id);await f.library.clearUnused();assert.ok(f.library.blob(key));assert.equal(await readFile(join(f.source,'family.jpg'),'utf8'),'source-photo');
}finally{await f.close();}});

test('10 GB 稀疏视频仅登记索引并以 HTTP Range 读取，拒绝越界与跨站读取',async()=>{const f=await fixture();const server=createAppServer((_req,res)=>res.end('test'),f.library);try{
  const file=await open(join(f.source,'huge.mp4'),'w');await file.truncate(10*1024**3);await file.write(Buffer.from('frame-data'),0,10,6*1024**3);await file.close();
  const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'huge.mp4'),url=await listen(server),path=`${url}/api/library/media/${record.id}/original?version=${record.version}`;
  assert.equal(record.size,10*1024**3);assert.equal(f.library.space().original,0);assert.deepEqual(await readdir(join(f.library.directory,'objects')),[]);
  const response=await fetch(path,{headers:{Range:`bytes=${6*1024**3}-${6*1024**3+9}`}});assert.equal(response.status,206);assert.equal(await response.text(),'frame-data');assert.equal(response.headers.get('content-length'),'10');
  assert.equal((await fetch(path,{method:'HEAD'})).headers.get('content-length'),String(record.size));assert.equal((await fetch(path,{headers:{Range:`bytes=${record.size}-`}})).status,416);
  assert.equal((await fetch(path,{headers:{Range:'bytes=-0'}})).status,416);assert.equal((await fetch(path,{headers:{Origin:'https://other.example'}})).status,403);assert.equal((await fetch(path,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
}finally{await closeServer(server);await f.close();}});

test('目录搬家保持引用，文件变更不会冒充旧版本，已保留画面仍可读取',async()=>{const f=await fixture();try{
  await writeFile(join(f.source,'clip.mp4'),'old-video');const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'clip.mp4');const key=f.library.previewKey(record.id,record.version,'print');await f.library.storeBlob(key,Readable.from(['saved-frame']),'image/jpeg','retained');
  const moved=join(f.directory,'moved');await rename(f.source,moved);await f.library.relinkRoot(root.id,moved);assert.equal(await f.library.file(record,record.version),join(moved,'clip.mp4'));
  await writeFile(join(moved,'clip.mp4'),'replacement-video');await assert.rejects(f.library.file(record,record.version),/发生变化/);const replacement=await f.library.referenceFile(root.id,'clip.mp4');assert.equal(replacement.id,record.id);assert.notEqual(replacement.version,record.version);assert.equal(await readFile(f.library.blob(key)!.file,'utf8'),'saved-frame');
}finally{await f.close();}});

test('登记目录内的符号链接不能读取目录外的私有文件',async()=>{const f=await fixture();try{
  const outside=join(f.directory,'outside.mp4');await writeFile(outside,'outside');await symlink(outside,join(f.source,'link.mp4'));const root=await f.library.registerRoot(f.source);await assert.rejects(f.library.referenceFile(root.id,'link.mp4'),/登记目录/);
  const job=f.library.scan(root.id);await waitJob(job);assert.equal(job.count,0);
}finally{await f.close();}});

test('缓存遵守预算，正在播放的原片与游记画面不会被普通清理移除',async()=>{const f=await fixture();try{
  f.library.setMeta('cacheLimitBytes',12);await f.library.storeBlob('cache-old',Readable.from(['old-cache']),'video/mp4','cache');await f.library.storeBlob('print-pinned',Readable.from(['kept-print']),'image/jpeg','retained');await f.library.storeBlob('cache-new',Readable.from(['new-cache']),'video/mp4','cache');
  assert.equal(f.library.blob('cache-old'),undefined);f.library.acquireLease('cache-new','viewer-1');await f.library.clearCache();assert.ok(f.library.blob('cache-new'));assert.ok(f.library.blob('print-pinned'));
  await assert.rejects(f.library.storeBlob('cache-third',Readable.from(['third-cache']),'video/mp4','cache'),/占满预算/);assert.ok(f.library.space().cache<=12);f.library.releaseLease('cache-new','viewer-1');await f.library.clearCache();assert.equal(f.library.space().cache,0);assert.ok(f.library.blob('print-pinned'));
}finally{await f.close();}});

test('内容去重只存一份，清理一个别名不会损坏其他游记保留的画面',async()=>{const f=await fixture();try{
  await f.library.storeBlob('same-1',Readable.from(['same-bytes']),'image/jpeg','retained');await f.library.storeBlob('same-2',Readable.from(['same-bytes']),'image/jpeg','retained');assert.equal(f.library.space().objects,1);assert.equal(f.library.space().retained,10);
  await f.library.removeBlob('same-1');assert.equal(await readFile(f.library.blob('same-2')!.file,'utf8'),'same-bytes');await writeFile(f.library.blob('same-2')!.file,'bad-bytes!');await f.library.storeBlob('same-3',Readable.from(['same-bytes']),'image/jpeg','retained');assert.equal(await readFile(f.library.blob('same-2')!.file,'utf8'),'same-bytes');assert.equal(f.library.space().objects,1);
}finally{await f.close();}});

test('原片传输中断不产生可用副本，也不损坏项目正文',async()=>{const f=await fixture();try{
  const trip=f.library.saveTrip(createTrip('保留正文'));const stream=Readable.from((async function*(){yield Buffer.from('partial');throw new Error('disconnected');})());await assert.rejects(f.library.storeBlob('media-interrupted',stream,'video/mp4','original'),/disconnected/);assert.equal(f.library.blob('media-interrupted'),undefined);assert.equal(f.library.trip(trip.id)?.title,'保留正文');assert.deepEqual(await readdir(join(f.library.directory,'temporary')),[]);
}finally{await f.close();}});

test('旧原件完整哈希不一致时不关联，核验凭据在原文件丢失或副本损坏后失效',async()=>{const f=await fixture();try{
  await writeFile(join(f.source,'old.mp4'),'correct');const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'old.mp4');await assert.rejects(f.library.verifyLegacy('media-old',record,Readable.from(['wrong!!']),7),/内容/);assert.equal(await f.library.legacyKeySafe('media-old',7),false);
  await f.library.verifyLegacy('media-old',record,Readable.from(['correct']),7);assert.equal(await f.library.legacyKeySafe('media-old',7),true);await rm(join(f.source,'old.mp4'));assert.equal(await f.library.legacyKeySafe('media-old',7),false);
  await f.library.storeBlob('media-copy',Readable.from(['correct']),'video/mp4','original');await writeFile(f.library.blob('media-copy')!.file,'corrupt');assert.equal(await f.library.legacyKeySafe('media-copy',7),false);
}finally{await f.close();}});

test('跨窗口保存冲突明确拒绝，旧项目重复迁移不覆盖之后的修改',async()=>{const f=await fixture();try{
  const trip=createTrip('原文'),first=f.library.saveTrip(trip);const edited=f.library.saveTrip({...trip,title:'后来修改'},first.storageRevision);assert.throws(()=>f.library.saveTrip({...trip,title:'另一窗口旧文'},first.storageRevision),/另一窗口/);assert.equal(f.library.trip(trip.id)?.title,'后来修改');assert.equal(f.library.bridgeLegacy(trip)?.title,'后来修改');assert.equal(f.library.trip(trip.id)?.storageRevision,edited.storageRevision);
}finally{await f.close();}});

test('游记备份保留画面和录音，恢复独立项目后原目录离线仍能阅读',async()=>{const f=await fixture();try{
  await writeFile(join(f.source,'trip.jpg'),'photo-original');const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'trip.jpg'),trip=createTrip('离线游记');trip.assets=[f.library.asAsset(record)];trip.coverId=trip.assets[0].id;trip.memories=[{id:'memory-1',text:'原始回忆',confirmed:true,facts:[],uncertain:[],audioKey:'audio-1',createdAt:new Date().toISOString()}];
  await f.library.storeBlob(f.library.previewKey(record.id,record.version,'print'),Readable.from(['print-picture']),'image/jpeg','retained');await f.library.storeBlob('audio-1',Readable.from(['original-voice']),'audio/webm','retained');f.library.saveTrip(trip);
  const job=startFolderExport(f.library,trip,false);await waitJob(job);await rm(f.source,{recursive:true});const restored=await restoreFolderPackage(f.library,job.directory);assert.notEqual(restored.id,trip.id);assert.notEqual(restored.assets[0].id,trip.assets[0].id);assert.equal(restored.assets[0].missing,false);assert.equal(await readFile(f.library.blob(restored.assets[0].thumbnailKey!)!.file,'utf8'),'print-picture');assert.equal(await readFile(f.library.blob(restored.memories[0].audioKey!)!.file,'utf8'),'original-voice');assert.equal(f.library.space().original,0);
}finally{await f.close();}});

test('携带原件的文件夹备份流式写入，恢复引用备份原件，损坏和越界路径会拒绝',async()=>{const f=await fixture();try{
  const bytes=Buffer.alloc(16*1024**2,42);await writeFile(join(f.source,'clip.mp4'),bytes);const root=await f.library.registerRoot(f.source),record=await f.library.referenceFile(root.id,'clip.mp4'),trip=createTrip('视频备份');trip.assets=[f.library.asAsset(record)];trip.coverId=trip.assets[0].id;await f.library.storeBlob(f.library.previewKey(record.id,record.version,'print'),Readable.from(['frame']),'image/jpeg','retained');f.library.saveTrip(trip);
  const job=startFolderExport(f.library,trip,true);await waitJob(job);assert.ok(job.bytes>16*1024**2);const restored=await restoreFolderPackage(f.library,job.directory);assert.ok(restored.assets[0].source?.kind==='local');assert.equal(f.library.space().original,0);const newRecord=f.library.record(restored.assets[0].source!.id);assert.equal((await stat(await f.library.file(newRecord))).size,bytes.length);
  const manifestPath=join(job.directory,'project.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));const picture=manifest.files.find((e:{kind:string})=>e.kind==='thumbnail');await writeFile(join(job.directory,picture.path),'tampered');const before=f.library.trips().length;await assert.rejects(restoreFolderPackage(f.library,job.directory),/大小|校验/);assert.equal(f.library.trips().length,before);
  picture.path='../outside.bin';await writeFile(manifestPath,JSON.stringify(manifest));await assert.rejects(restoreFolderPackage(f.library,job.directory),/路径/);
}finally{await f.close();}});

test('网盘导入只登记引用，原片在准备时才下载，错误账号拒绝且凭据不入库',async()=>{const f=await fixture();let originalCalls=0,remoteVersion=1;const fetcher=(async(address:RequestInfo|URL)=>{const url=new URL(String(address));if(url.searchParams.get('method')==='uinfo')return Response.json({errno:0,uk:url.searchParams.get('access_token')==='other-token'?'account-2':'account-1'});if(url.searchParams.get('method')==='filemetas')return Response.json({errno:0,list:[{fs_id:123,server_filename:'trip.mp4',size:10,server_mtime:remoteVersion,dlink:'https://download.baidupcs.com/file',thumbs:{}}]});if(url.hostname==='download.baidupcs.com'){originalCalls++;return new Response('video-data');}throw new Error('unexpected mock request');}) as typeof fetch;
  const handler=createLibraryHandler(f.library,fetcher),server=createServer((req,res)=>void handler(req,res));try{const base=await listen(server);const post=async(path:string,body:unknown)=>{const r=await fetch(base+'/api/library'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const connect=await post('/baidu/connect',{token:'private-token'}),registration=await post('/baidu/register',{session:connect.data.session,files:[{id:123,name:'trip.mp4',path:'/trip.mp4',size:10}]});const asset=registration.data.assets[0];assert.equal(originalCalls,0);assert.equal(f.library.space().original,0);assert.equal(f.library.space().cache,0);const other=await post('/baidu/connect',{token:'other-token'});assert.equal((await post(`/media/${asset.source.id}/prepare`,{session:other.data.session})).status,401);
  assert.equal((await post(`/media/${asset.source.id}/prepare`,{session:connect.data.session})).status,200);assert.equal(originalCalls,1);assert.equal(f.library.space().cache,10);await post(`/media/${asset.source.id}/release`,{});assert.equal(f.library.space().cache,0);
  const trip=createTrip('网盘原件备份');trip.assets=[asset];trip.coverId=asset.id;await f.library.storeBlob(f.library.previewKey(asset.source.id,asset.source.version,'print'),Readable.from(['picture']),'image/jpeg','retained');f.library.saveTrip(trip);f.library.setMeta('cacheLimitBytes',1);
  let {job}=(await post('/exports',{tripId:trip.id,originals:true,session:connect.data.session})).data;while(job.status==='running'){await new Promise(resolve=>setTimeout(resolve,10));job=await(await fetch(base+'/api/library/exports/'+job.id)).json().then(r=>r.job);}assert.equal(job.status,'complete',job.error);assert.equal(originalCalls,2);assert.equal(f.library.space().cache,0);assert.equal(f.library.space().original,0);
  remoteVersion=2;const changed=await post('/baidu/register',{session:connect.data.session,files:[{id:123,name:'trip.mp4',path:'/trip.mp4',size:10}]});assert.equal(changed.data.assets[0].source.id,asset.source.id);assert.notEqual(changed.data.assets[0].source.version,asset.source.version);assert.equal((await post(`/media/${asset.source.id}/prepare?version=${asset.source.version}`,{session:connect.data.session})).status,409);assert.ok(f.library.blob(f.library.previewKey(asset.source.id,asset.source.version,'print')));
  assert.ok(!JSON.stringify(f.library.trips()).includes('private-token'));assert.ok(!JSON.stringify(f.library.media()).includes('private-token'));assert.equal(f.library.getMeta('token'),undefined);
}finally{await closeServer(server);await f.close();}});
