import test from 'node:test';
import assert from 'node:assert/strict';
import {demoTrips} from '../src/demo';
import {layoutCandidates,layoutProposal,nearestCandidate} from '../src/auto-layout';
import {paginate} from '../src/layout';
import {validateTrip} from '../src/domain';

test('自动排版保护锁定章节、正文和手工顺序，首次成书包含所有精选素材',()=>{
 const trip=structuredClone(demoTrips[0]);trip.chapters[0].locked=true;trip.chapters[1].assetIds.reverse();
 for(const density of ['spacious','balanced','compact'] as const){const next=layoutProposal(trip,density);assert.deepEqual(next.chapters[0],trip.chapters[0]);for(let i=0;i<trip.chapters.length;i++){assert.equal(next.chapters[i].body,trip.chapters[i].body);assert.deepEqual(next.chapters[i].assetIds,trip.chapters[i].assetIds);}}
 const fresh=layoutProposal({...trip,chapters:[],stops:[]},'balanced',true);assert.deepEqual(new Set(fresh.chapters.flatMap(c=>c.assetIds)),new Set(trip.assets.filter(a=>a.selected).map(a=>a.id)));
 const saved=validateTrip(fresh);assert.equal(saved.chapters[0].layout,'adaptive');assert.equal(saved.chapters[0].density,'balanced');
});
test('页数目标越界拒绝，无法达到时保留全部内容',()=>{
 assert.equal(nearestCandidate([10,8,6],7),1);
 for(const n of [0,-1,1.5,NaN,Infinity,1001])assert.throws(()=>nearestCandidate([10],n),/目标页数/);
 const trip=structuredClone(demoTrips[0]);const options=layoutCandidates(trip);for(const o of options)assert.deepEqual(o.trip.chapters.map(c=>c.body),trip.chapters.map(c=>c.body));assert.ok(options.every(o=>o.pages.length>1));
});
test('自适应分页组合边界：极端比例、单双图、长正文、留白与装订边距',()=>{
 for(const density of ['spacious','balanced','compact'] as const)for(const margin of [12,30])for(const binding of [0,15])for(const count of [0,1,2,7]){
  const trip=structuredClone(demoTrips[0]);trip.margin=margin;trip.binding=binding;
  trip.assets=Array.from({length:count},(_,i)=>({...trip.assets[0],id:`photo-${i}`,selected:true,width:[4000,100,1000,0][i%4],height:[100,4000,1000,0][i%4]}));
  const body='这是必须完整保存的正文，不能为了凑页数丢失。'.repeat(120);
  trip.chapters=[{id:'chapter',title:'标题'.repeat(60),body,assetIds:trip.assets.map(a=>a.id),layout:'adaptive',density,locked:false,imageHeight:110}];
  const pages=paginate(trip).filter(p=>!p.cover);assert.ok(pages.length<100);
  const images=pages.flatMap(p=>p.blocks.filter(b=>b.type==='image'));assert.deepEqual(images.map(b=>b.assetId),trip.assets.map(a=>a.id));
  for(const block of images){assert.ok(block.width>0&&block.height>0);assert.ok(block.x>=margin+binding);assert.ok(block.x+block.width<=210-margin+.01);assert.ok(block.y+block.height<=297-margin-10+.01);}
  const output=pages.flatMap(p=>p.blocks.flatMap(b=>b.type==='text'&&b.size===11?[b.text]:[])).join('');assert.equal(output,body);
 }
});
