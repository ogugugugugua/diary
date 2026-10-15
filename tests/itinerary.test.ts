import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTrips } from '../src/demo';
import { validateTrip } from '../src/domain';
import { cameraDate, validDate, chronological, suggestStops, assignToStop, chaptersFromStops } from '../src/itinerary';
import { lightweightBackup, restoreProject } from '../src/backup';

test('相机时间保留秒且不受服务器时区影响；无效日期不进入排序',()=>{
  assert.equal(cameraDate('2026:10:02 07:08:09'),'2026-10-02T07:08:09');
  assert.equal(validDate('2026-02-30T07:00'),false);
  const a=demoTrips[0].assets[0];
  const sorted=chronological([{...a,id:'unknown',date:''},{...a,id:'late',date:'2026-10-02T08:01:00',utcOffset:'+09:00'},{...a,id:'early',date:'2026-10-02T07:00:00',utcOffset:'+08:00'}]);
  assert.deepEqual(sorted.map(a=>a.id),['early','late','unknown']);
});
test('站点增量分组、拆分、章节精选与备份恢复保持关联',async()=>{
  let trip=structuredClone(demoTrips[0]);trip.chapters=[];
  trip.assets=trip.assets.slice(0,3).map((a,i)=>({...a,date:`2026-10-02T08:00:0${i}`,location:'京都',selected:i!==1}));
  trip.stops=suggestStops(trip);assert.equal(trip.stops.length,1);assert.equal(suggestStops(trip).length,0);
  trip.stops.push({id:'manual',title:'晚间散步',date:'2026-10-02',location:'京都',story:'我们沿河散步。',assetIds:[]});
  trip=assignToStop(trip,[trip.assets[2].id],'manual');assert.equal(trip.stops![0].assetIds.length,2);
  trip.chapters=chaptersFromStops(trip);assert.equal(trip.chapters.length,2);assert.equal(trip.chapters[0].assetIds.length,1);
  const restored=(await restoreProject(new File([lightweightBackup(trip)],'trip.json'))).trip;
  assert.notEqual(restored.stops![0].id,trip.stops![0].id);
  assert.deepEqual(restored.chapters[1].stopIds,[restored.stops![1].id]);
  assert.equal(restored.stops![1].story,'我们沿河散步。');
  assert.equal(restored.stops![1].assetIds[0],restored.assets[2].id);
  assert.equal(validateTrip(restored).assets[0].date,'2026-10-02T08:00:00');
});

test('日期与时区边界：闰日、午夜、秒、缺失值与非法偏移',async()=>{
 const {validOffset}=await import('../src/itinerary');
 for(const date of ['2024-02-29','2026-12-31T23:59:59','2026-01-01T00:00'])assert.ok(validDate(date),date);
 for(const date of ['','2026-02-29','2026-13-01','2026-01-00','2026-01-01T24:00','2026-01-01T00:60','2026-01-01T12:00:60','text'])assert.equal(validDate(date),false,date);
 for(const offset of ['+14:00','-12:00','+05:30','+00:00'])assert.ok(validOffset(offset));
 for(const offset of ['+14:01','+15:00','08:00','+8:00','-00:60',undefined])assert.equal(validOffset(offset),false);
});
test('站点未知信息不猜测，非法移动不丢素材，重复站点编号拒绝',()=>{
 let trip=structuredClone(demoTrips[0]);trip.assets=trip.assets.slice(0,2).map(a=>({...a,date:'',location:''}));trip.stops=suggestStops(trip);
 assert.equal(trip.stops.length,1);assert.equal(trip.stops[0].date,'');assert.equal(trip.stops[0].title,'待补充地点');
 assert.deepEqual(assignToStop(trip,[trip.assets[0].id],'absent'),trip);
 trip=assignToStop(trip,[trip.assets[0].id],'');assert.equal(trip.stops![0].assetIds.length,1);assert.equal(suggestStops(trip)[0].assetIds[0],trip.assets[0].id);
 assert.throws(()=>validateTrip({...trip,stops:[trip.stops![0],trip.stops![0]]}),/编号重复/);
});
