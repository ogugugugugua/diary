import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBlob, listTrips, saveTrip, deleteTrip } from '../src/db';
import { createTrip } from '../src/domain';

test('素材与项目持久保存，重新读取仍可使用',async()=>{
  const trip=createTrip('本地持久项目');await saveTrip(trip,[{key:'persist-fixture',blob:new Blob(['asset'],{type:'image/jpeg'})}]);
  assert.ok((await listTrips()).some(t=>t.id===trip.id));assert.equal(await (await getBlob('persist-fixture'))?.text(),'asset');
  await deleteTrip(trip);assert.equal(await getBlob('persist-fixture'),undefined);
});
test('删除游记清理历史孤立录音，同时保留其他游记的素材',async()=>{
  const one=createTrip('第一本'),two=createTrip('第二本');await saveTrip(one,[{key:'orphan-fixture',blob:new Blob(['old audio'])}]);await saveTrip(two,[{key:'other-fixture',blob:new Blob(['keep'])}]);
  await saveTrip(one);await deleteTrip(one);assert.equal(await getBlob('orphan-fixture'),undefined);assert.equal(await (await getBlob('other-fixture'))?.text(),'keep');await deleteTrip(two);
});
