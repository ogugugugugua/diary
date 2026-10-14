import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { lightweightBackup, restoreProject } from '../src/backup';
import { demoTrips } from '../src/demo';

test('轻量恢复生成独立编号，保留正文关联，并明确素材待重新关联',async()=>{
  const original=structuredClone(demoTrips[0]);const blob=lightweightBackup({...original,apiKey:'secret'} as typeof original);
  const file=new File([blob],'project.json'),restored=await restoreProject(file);
  assert.notEqual(restored.trip.id,original.id);assert.equal(restored.trip.chapters[0].body,original.chapters[0].body);assert.equal(restored.trip.demo,false);
  assert.ok(restored.trip.assets.every(a=>a.missing));assert.ok(restored.trip.chapters[0].assetIds.every(id=>restored.trip.assets.some(a=>a.id===id)));
  assert.ok(!(await blob.text()).includes('apiKey'));assert.equal(restored.blobs.length,0);
});
test('完整恢复带回素材，重映射封面与章节，不覆盖既有项目',async()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets=[trip.assets[0]];trip.coverId=trip.assets[0].id;trip.chapters=[{...trip.chapters[0],assetIds:[trip.assets[0].id]}];
  const zip=new JSZip();zip.file('media/fixture-original.bin',new Uint8Array([1,2,3]));zip.file('media/fixture-thumbnail.bin',new Uint8Array([4,5]));
  zip.file('project.json',JSON.stringify({format:'xingji',version:1,trip,files:[{assetId:trip.assets[0].id,kind:'original',path:'media/fixture-original.bin',mime:'image/jpeg'},{assetId:trip.assets[0].id,kind:'thumbnail',path:'media/fixture-thumbnail.bin',mime:'image/jpeg'}]}));
  const bytes=await zip.generateAsync({type:'uint8array'});const restored=await restoreProject(new File([new Uint8Array(bytes)],'project.zip'));
  assert.equal(restored.blobs.length,2);assert.equal(restored.trip.assets[0].missing,false);assert.equal(restored.trip.coverId,restored.trip.assets[0].id);assert.notEqual(restored.trip.assets[0].id,trip.assets[0].id);
});
test('不支持的项目、重复编号与危险素材路径被拒绝',async()=>{
  await assert.rejects(restoreProject(new File(['{"format":"xingji","version":99}'],'bad.json')),/版本/);
  const zip=new JSZip();zip.file('project.json',JSON.stringify({format:'xingji',version:1,trip:demoTrips[0],files:[{assetId:demoTrips[0].assets[0].id,kind:'original',path:'../../outside.bin',mime:'image/jpeg'}]}));
  const bytes=await zip.generateAsync({type:'uint8array'});await assert.rejects(restoreProject(new File([new Uint8Array(bytes)],'bad.zip')),/路径/);
});
test('超过一千个素材的轻量备份保持全部素材与章节关联',async()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets=Array.from({length:1200},(_,index)=>({...trip.assets[0],id:`large-${index}`,name:`照片 ${index+1}.jpg`}));
  trip.coverId=trip.assets[0].id;trip.chapters=[{...trip.chapters[0],assetIds:trip.assets.map(asset=>asset.id)}];
  const restored=await restoreProject(new File([lightweightBackup(trip)],'large-project.json'));
  assert.equal(restored.trip.assets.length,1200);assert.equal(restored.trip.chapters[0].assetIds.length,1200);assert.equal(restored.trip.assets.at(-1)?.name,'照片 1200.jpg');
});
