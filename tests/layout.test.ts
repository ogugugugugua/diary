import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate, printWarnings, wrapText } from '../src/layout';
import { demoTrips } from '../src/demo';

test('长篇中文分页保持完整正文，图文元素留在A4内容范围内',()=>{
  const trip=structuredClone(demoTrips[0]);const body='这是一次全家一起出发的旅行，风景与回忆都值得珍藏。'.repeat(180);
  trip.chapters=[{...trip.chapters[0],body,assetIds:trip.assets.map(a=>a.id),layout:'album'}];
  const pages=paginate(trip);assert.ok(pages.length>4&&pages.length<50);
  const printed=pages.filter(p=>!p.cover).flatMap(p=>p.blocks).filter(b=>b.type==='text'&&b.size===11).map(b=>b.type==='text'?b.text:'').join('');assert.equal(printed,body);
  const pictures=pages.filter(p=>!p.cover).flatMap(p=>p.blocks).filter(b=>b.type==='image');assert.equal(pictures.length,trip.assets.length);
  for(const page of pages)for(const block of page.blocks){assert.ok(block.x>=12&&block.x<210);assert.ok(block.y>=0&&block.y<297);if(block.type==='image'){assert.ok(block.x+block.width<=190.01);assert.ok(block.y+block.height<280);}}
});
test('长章节标题不会阻塞分页或造成无限循环',()=>{
  const trip=structuredClone(demoTrips[0]);trip.chapters=[{...trip.chapters[0],title:'长标题'.repeat(2000),body:'正文'.repeat(1000),assetIds:[]}];
  const pages=paginate(trip);assert.ok(pages.length>1&&pages.length<30);
  const printed=pages.slice(1).flatMap(p=>p.blocks).filter(b=>b.type==='text'&&b.size===11).map(b=>b.type==='text'?b.text:'').join('');assert.equal(printed,trip.chapters[0].body);
});
test('低分辨率与缺失图片会进入打印检查，而不是悄悄打印空图',()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets[0].width=200;trip.assets[0].height=150;trip.assets[1].missing=true;
  const pages=paginate(trip),warnings=printWarnings(trip,pages);
  assert.ok(warnings.some(w=>w.assetId===trip.assets[0].id&&w.message.includes('DPI')));
  assert.ok(warnings.some(w=>w.assetId===trip.assets[1].id&&w.message.includes('原文件')));
  assert.ok(!pages.some(p=>p.blocks.some(b=>b.type==='image'&&b.assetId===trip.assets[1].id)));
});
test('换行支持中文、英文与显式段落，单字符不会丢失',()=>{
  const input='A family trip 家人的旅行\n\n把旅途写成一本书。';const lines=wrapText(input,30,11);
  assert.ok(lines.includes(''));assert.equal(lines.join('').replaceAll(' ',''),input.replaceAll(/\s/g,''));
});
test('封面照片再次作为配图时，长图注仍进入导出前检查',()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets[0].caption='需要放入正文的较长故事'.repeat(30);
  assert.ok(printWarnings(trip,paginate(trip)).some(w=>w.assetId===trip.assets[0].id&&w.message.includes('图注超过两行')));
});
test('保留完整画面时，清晰度按实际缩放尺寸计算',()=>{
  const trip=structuredClone(demoTrips[0]);trip.assets=trip.assets.slice(0,1);trip.assets[0].width=3000;trip.assets[0].height=150;trip.assets[0].fit='contain';trip.chapters=[];
  assert.ok(!printWarnings(trip,paginate(trip)).some(w=>w.message.includes('DPI')));
});
