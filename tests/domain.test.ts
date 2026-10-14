import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrip, mergeGeneratedChapters, parseExtracted, parseGenerated, validateTrip, chaptersFromAssets } from '../src/domain';
import { demoTrips } from '../src/demo';

test('重新生成保护锁定章节，并保留对应章节编号',()=>{
  const old=structuredClone(demoTrips[0].chapters);old[1].locked=true;old[1].body='家人手工写好的正文';
  const incoming=old.map((c,i)=>({...c,id:`new-${i}`,body:'新正文',locked:false}));
  const merged=mergeGeneratedChapters(old,incoming);
  assert.equal(merged[0].body,'新正文');assert.deepEqual(merged[1],old[1]);assert.equal(merged[2].id,old[2].id);assert.equal(merged.length,3);
});
test('备份验证只保留项目字段，排除凭据、无效素材引用与任意外部图片地址',()=>{
  const source=structuredClone(demoTrips[0]);source.assets[0].src='https://untrusted.example/image.jpg';
  const validated=validateTrip({...source,apiKey:'not-a-real-key',baiduToken:'not-a-real-token',settings:{apiKey:'hidden'}});
  assert.equal('apiKey' in validated,false);assert.equal('settings' in validated,false);assert.equal(validated.assets[0].src,undefined);
  assert.throws(()=>validateTrip({...source,assets:[source.assets[0],source.assets[0]]}),/重复/);
});
test('模型结果只引用已选素材，不接受模型编造的素材编号',()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets[1].selected=false;
  const result=parseGenerated(JSON.stringify({chapters:[{title:'第一天',body:'真实回忆',assetIds:[trip.assets[0].id,trip.assets[1].id,'made-up']}]}),trip);
  assert.deepEqual(result[0].assetIds,[trip.assets[0].id]);
  assert.throws(()=>parseGenerated('{"chapters":[]}',trip),/没有返回章节/);
});
test('提取结果支持JSON代码块，未知内容保留为空并要求确认',()=>{
  const result=parseExtracted('```json\n{"facts":[{"event":"散步"}],"uncertain":["地点待确认"]}\n```');
  assert.deepEqual(result.facts[0],{date:'',place:'',event:'散步',feeling:''});assert.equal(result.uncertain[0],'地点待确认');
  assert.throws(()=>parseExtracted('这里是模型解释，不是JSON'),/无法解析/);
});
test('时间线仅使用已选素材，缺少拍摄日期时不会虚构日期',()=>{
  const trip=createTrip('旅行');trip.assets=structuredClone(demoTrips[0].assets);trip.assets[0].date='';trip.assets[1].selected=false;
  const chapters=chaptersFromAssets(trip);assert.ok(chapters.some(c=>c.title==='旅途中的片刻'));assert.equal(chapters.flatMap(c=>c.assetIds).length,5);
});
