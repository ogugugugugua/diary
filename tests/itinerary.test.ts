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
