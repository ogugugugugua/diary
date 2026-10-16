import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {videoLink,frameTime,qrSymbol} from '../src/video-link';
import {demoTrips} from '../src/demo';
import {paginate} from '../src/layout';
import {validateTrip} from '../src/domain';
import {lightweightBackup,restoreProject} from '../src/backup';
const link='https://example.com/travel/video?id=clip-1';
test('视频链接边界：HTTPS、公开主机、临时密钥、Unicode与500字节限制',()=>{
 assert.equal(videoLink(' '+link+' '),link);assert.equal(videoLink('https://1drv.ms/v/fixture'),'https://1drv.ms/v/fixture');assert.equal(videoLink(undefined),undefined);assert.equal(videoLink(''),undefined);
 for(const bad of ['file:///tmp/movie.mp4','blob:https://example.com/id','javascript:alert(1)','data:text/plain,test','http://example.com','https://localhost/video','https://192.168.0.1/v','https://[::1]/v','https://user:secret@example.com/v','https://example.com/v?access_token=secret','https://example.com/v?X-Amz-Signature=secret',123])assert.throws(()=>videoLink(bad));
 const max='https://example.com/'+ 'a'.repeat(480);assert.equal(max.length,500);assert.equal(videoLink(max),max);assert.throws(()=>videoLink(max+'a'),/过长/);assert.match(videoLink('https://example.com/旅行')!,/%E6/);
 const trip=structuredClone(demoTrips[0]);trip.assets[0].kind='video';trip.assets[0].videoUrl='file:///tmp/video';assert.throws(()=>validateTrip(trip),/HTTPS/);
});
test('关键帧时间：零、短视频、片尾钳制与非法时间/时长',()=>{
 assert.equal(frameTime(0,2),0);assert.equal(frameTime(1.5,2),1.5);assert.equal(frameTime(99,2),1.95);assert.equal(frameTime(.5,.01),0);
 for(const time of [-1,NaN,Infinity])assert.throws(()=>frameTime(time,2));for(const duration of [0,-1,NaN,Infinity])assert.throws(()=>frameTime(0,duration));
});
test('二维码独立解码：普通、中文、带参数、最大长度，保留4模块白边',()=>{
 for(const input of [link,'https://example.com/旅行?章节=夏天','https://example.com/'+'a'.repeat(480)]){
  const url=videoLink(input)!,symbol=qrSymbol(url),scale=5,width=symbol.size*scale,rgba=new Uint8ClampedArray(width*width*4).fill(255);
  for(const r of symbol.rects){assert.ok(r.x>=4&&r.y>=4&&r.x+r.width<=symbol.size-4&&r.y<symbol.size-4);for(let y=r.y*scale;y<(r.y+1)*scale;y++)for(let x=r.x*scale;x<(r.x+r.width)*scale;x++){const p=(y*width+x)*4;rgba[p]=rgba[p+1]=rgba[p+2]=0;}}
  const decoded=jsQR(rgba,width,width);assert.equal(decoded?.data,url);
 }
});
test('含二维码的72组分页组合：全图全文、封面与章节不越界、不遮挡',()=>{
 for(const layout of ['balanced','album','journal','spacious','balanced-adaptive','compact'])for(const margin of [12,30])for(const binding of [0,15])for(const count of [1,2,5]){
  const trip=structuredClone(demoTrips[0]);trip.margin=margin;trip.binding=binding;trip.assets=Array.from({length:count},(_,i)=>({...trip.assets[0],id:`video-${i}`,kind:'video' as const,thumbnailKey:`thumb-${i}`,videoUrl:link,selected:true,width:i%2?100:4000,height:i%2?4000:100}));trip.coverId=trip.assets[0].id;
  const body='视频的故事要完整保留。'.repeat(80);trip.chapters=[{id:'chapter',title:'长标题'.repeat(45),body,assetIds:trip.assets.map(a=>a.id),layout:['balanced','album','journal'].includes(layout)?layout as 'balanced'|'album'|'journal':'adaptive',density:layout==='spacious'?'spacious':layout==='compact'?'compact':'balanced',imageHeight:110,locked:false}];
  const pages=paginate(trip);assert.equal(pages[0].blocks.filter(b=>b.type==='qr').length,1);const printed=pages.slice(1).flatMap(p=>p.blocks);assert.equal(printed.filter(b=>b.type==='image').length,count);assert.equal(printed.filter(b=>b.type==='qr').length,count);assert.equal(printed.flatMap(b=>b.type==='text'&&b.size===11?[b.text]:[]).join(''),body);
  for(const page of pages){const pictures=page.blocks.filter(b=>b.type==='image'||b.type==='qr');for(const block of pictures){assert.ok(block.width>0&&block.height>0);assert.ok(block.x>=margin+binding);assert.ok(block.x+block.width<=210-margin+.01);assert.ok(block.y+block.height<=297-margin-10+.01);}
   for(const qr of pictures.filter(b=>b.type==='qr'))for(const photo of pictures.filter(b=>b.type==='image'))assert.ok(qr.x>=photo.x+photo.width||qr.x+qr.width<=photo.x||qr.y>=photo.y+photo.height||qr.y+qr.height<=photo.y);
  }
 }
});
test('视频链接和取帧时间备份恢复，旧项目、空链接和图片不会产生二维码',async()=>{
 const trip=structuredClone(demoTrips[0]);trip.assets[0]={...trip.assets[0],kind:'video',thumbnailKey:'thumb-fixture',videoUrl:link,videoFrameTime:1.5};
 const restored=await restoreProject(new File([lightweightBackup(trip)],'video.json'));assert.equal(restored.trip.assets[0].videoUrl,link);assert.equal(restored.trip.assets[0].videoFrameTime,1.5);assert.notEqual(restored.trip.assets[0].id,trip.assets[0].id);
 const old=structuredClone(demoTrips[0]);assert.ok(paginate(validateTrip(old)).every(p=>p.blocks.every(b=>b.type!=='qr')));old.assets[0].videoUrl=link;assert.equal(validateTrip(old).assets[0].videoUrl,undefined);
 trip.assets[0].videoUrl='';assert.ok(paginate(trip).every(p=>p.blocks.every(b=>b.type!=='qr')));
});
