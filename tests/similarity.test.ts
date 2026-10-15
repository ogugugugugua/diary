import test from 'node:test';
import assert from 'node:assert/strict';
import {demoTrips} from '../src/demo';
import {differenceHash,hashDistance,similarGroups,burstGroups,visualSource} from '../src/similarity';
import {validateTrip} from '../src/domain';

test('视觉分组匹配近似指纹，排除颜色比例不同以及过期索引',()=>{
 const assets=Array.from({length:5},(_,i)=>({...demoTrips[0].assets[0],id:String(i)}));
 assets.forEach((a,i)=>{a.visual={source:visualSource(a),hash:i===1?'fffffffffffffffe':'ffffffffffffffff',color:[80,90,100],aspect:1.5};});
 assets[2].visual!.color=[240,10,10];assets[3].visual!.aspect=.66;assets[4].visual!.source='outdated';
 assert.deepEqual(similarGroups(assets).map(g=>g.map(a=>a.id)),[['0','1']]);
 assert.equal(hashDistance('ffffffffffffffff','0000000000000000'),64);
 assert.equal(differenceHash(new Uint8Array(9*8*4)),'0000000000000000');
});
test('连拍需要完整时刻；评级与标签通过项目校验保留',()=>{
 const trip=structuredClone(demoTrips[0]);trip.assets=trip.assets.slice(0,3).map((a,i)=>({...a,date:i===2?'2026-10-02':`2026-10-02T08:00:0${i}`,location:'湖边',rating:5,tags:['旅行','合影']}));
 assert.equal(burstGroups(trip.assets)[0].length,2);const saved=validateTrip(trip);assert.equal(saved.assets[0].rating,5);assert.deepEqual(saved.assets[0].tags,['旅行','合影']);
});

test('视觉索引校验拒绝畸形哈希、非有限数、非法颜色和异常比例',async()=>{
 const {validVisual}=await import('../src/similarity');const valid={source:'source',hash:'0123456789abcdef',color:[0,128,255],aspect:1.5};
 assert.deepEqual(validVisual(valid),valid);
 for(const patch of [{hash:'not-hex'},{hash:'0'},{color:[0,1]},{color:[-1,2,3]},{color:[0,NaN,1]},{aspect:0},{aspect:Infinity},{source:22}])assert.equal(validVisual({...valid,...patch}),undefined);
 assert.throws(()=>differenceHash(new Uint8Array(10)),/像素/);
});
test('相似分组可处理2万张相同画面，不重复分组或丢素材',()=>{
 const a=demoTrips[0].assets[0];const assets=Array.from({length:20000},(_,i)=>({...a,id:String(i),visual:{source:visualSource(a),hash:'0123456789abcdef',color:[50,80,120],aspect:1.5}}));
 const groups=similarGroups(assets);assert.equal(groups.length,1);assert.equal(new Set(groups[0].map(a=>a.id)).size,20000);
});
test('评级范围、标签去重与备份回读；旧项目默认未评级',async()=>{
 const {lightweightBackup,restoreProject}=await import('../src/backup');const trip=structuredClone(demoTrips[0]);trip.assets[0].rating=99;trip.assets[0].tags=['合影','合影',''];
 const validated=validateTrip(trip);assert.equal(validated.assets[0].rating,5);assert.deepEqual(validated.assets[0].tags,['合影']);assert.equal(validated.assets[1].rating,0);
 const restored=(await restoreProject(new File([lightweightBackup(validated)],'ratings.json'))).trip;assert.equal(restored.assets[0].rating,5);assert.deepEqual(restored.assets[0].tags,['合影']);
});
