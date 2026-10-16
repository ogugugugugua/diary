import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MediaLibrary} from '../server/library';
import {handleSemantic,normalizeVector,cosine,embed} from '../server/semantic';
const config={baseUrl:'https://models.example.com/v1',model:'fixture',apiKey:'private-test-secret'};
const image='data:image/jpeg;base64,AQID';
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'diary-search-'));const library=new MediaLibrary(dir);let calls=0;let bad=false;
 const fetcher=(async(url:RequestInfo|URL,init?:RequestInit)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-test-secret');const data=JSON.parse(String(init?.body));if(String(url).endsWith('/chat/completions')){assert.equal(data.messages[1].content[1].type,'image_url');return Response.json({choices:[{message:{content:'湖水旁有两个人散步，远处是山。'}}]});}assert.equal(data.encoding_format,'float');if(bad)return new Response('private-test-secret',{status:401});return Response.json({data:[{index:0,embedding:[1,0,0]}]});}) as typeof fetch;
 const request=async(body:Record<string,unknown>)=>handleSemantic(new Request('http://localhost/api/semantic',{method:'POST',body:JSON.stringify({writer:config,embedding:config,...body})}),library,fetcher);
 return {library,request,calls:()=>calls,reject:()=>{bad=true;},async close(){library.close();await rm(dir,{recursive:true,force:true});}};}
test('语义检索从图片描述建立向量，持久索引、缓存命中与来源/模型隔离',async()=>{const f=await fixture();try{
 assert.equal((await f.request({action:'index',source:'photo-v1',image})).status,200);assert.equal(f.calls(),2);
 assert.equal((await f.request({action:'index',source:'photo-v1',image})).status,200);assert.equal(f.calls(),2);
 const sources=[{id:'a',source:'photo-v1'},{id:'b',source:'photo-v2'}];
 assert.deepEqual((await(await f.request({action:'status',sources})).json()).indexed,['a']);
 const result=await(await f.request({action:'search',sources,query:'水边的合影',minimum:.5})).json();assert.equal(result.results[0].id,'a');assert.equal(result.results[0].score,1);assert.equal(result.unindexed,1);assert.match(result.results[0].description,/湖水/);
 const other=await(await f.request({action:'status',sources,embedding:{...config,model:'other-model'}})).json();assert.deepEqual(other.indexed,[]);
 const stored=f.library.db.prepare('SELECT * FROM semantic_index').all();assert.ok(!JSON.stringify(stored).includes(config.apiKey));assert.ok(!JSON.stringify(stored).includes(image));
 await f.request({action:'clear',sources:[sources[0]]});assert.equal((await(await f.request({action:'status',sources})).json()).indexed.length,0);
}finally{await f.close();}});
test('语义接口拒绝非法范围和输入，空索引不调用模型，401不回显密钥',async()=>{const f=await fixture();try{
 for(const patch of [{action:'index',source:'',image},{action:'index',source:'a',image:'file:///private'},{action:'search',sources:[],query:'',minimum:0},{action:'search',sources:[],query:'湖',minimum:2},{action:'search',sources:new Array(20001).fill({id:'a',source:'a'}),query:'湖',minimum:.5},{action:'search',sources:[],query:'湖',minimum:0,embedding:{...config,baseUrl:'http://192.168.0.1/v1'}}])assert.equal((await f.request(patch)).status,400);
 assert.equal(f.calls(),0);assert.deepEqual((await(await f.request({action:'search',sources:[],query:'湖边',minimum:.3})).json()).results,[]);assert.equal(f.calls(),0);
 f.reject();const failure=await f.request({action:'index',source:'a',image});assert.equal(failure.status,400);assert.ok(!(await failure.text()).includes(config.apiKey));assert.equal(f.library.db.prepare('SELECT count(*) AS n FROM semantic_index').get()!.n,0);
}finally{await f.close();}});
test('向量边界：零向量、NaN、过长、维度改变、响应不匹配与畸形JSON',async()=>{
 assert.deepEqual(normalizeVector([3,4]),[.6,.8]);assert.equal(cosine([1,0],[0,1]),0);assert.throws(()=>cosine([1,0],[1,0,0]),/维度/);
 for(const value of [[],[0,0],[NaN,1],[Infinity,1],['1',0],Array(4097).fill(1)])assert.throws(()=>normalizeVector(value));
 for(const data of [{data:[]},{data:[{index:1,embedding:[1,0]}]},{data:[{embedding:[0,0]}]}])await assert.rejects(embed('湖边',config,async()=>Response.json(data),false));
 await assert.rejects(embed('湖边',config,async()=>new Response('not-json'),false),/JSON/);
 await assert.rejects(embed('湖边',config,async()=>new Response('x'.repeat(1024*1024+1)),false),/过大/);
});
test('语义排名与规模边界：阈值、稳定前100项、2万素材范围、维度变化',async()=>{const f=await fixture();try{
 await f.request({action:'index',source:'seed',image});const ns=f.library.db.prepare('SELECT namespace FROM semantic_index LIMIT 1').get()!.namespace;
 const insert=f.library.db.prepare('INSERT INTO semantic_index VALUES(?,?,?,?,?)');
 for(let i=0;i<125;i++)insert.run(ns,`photo-${i}`,'仅供测试的场景',JSON.stringify(i<120?[1,0,0]:[0,1,0]),'2026-10-16');
 const sources=Array.from({length:20000},(_,i)=>({id:`asset-${i}`,source:`photo-${i}`}));
 const found=await(await f.request({action:'search',sources,query:'水边合影',minimum:.5})).json();assert.equal(found.indexed,125);assert.equal(found.unindexed,19875);assert.equal(found.results.length,100);assert.deepEqual(found.results.map((r:{id:string})=>r.id),sources.slice(0,100).map(r=>r.id));
 const none=await(await f.request({action:'search',sources:sources.slice(120,125),query:'湖边',minimum:1})).json();assert.equal(none.results.length,0);
 f.library.db.prepare('UPDATE semantic_index SET vector=? WHERE source=?').run('[1,0]','photo-0');const changed=await f.request({action:'search',sources:sources.slice(0,1),query:'湖',minimum:0});assert.equal(changed.status,400);assert.match((await changed.json()).error,/维度/);
}finally{await f.close();}});
test('模型超时和错误响应不会形成半成品索引，查询失败保留已有索引',async()=>{const f=await fixture();try{
 await f.request({action:'index',source:'a',image});f.reject();const r=await f.request({action:'search',sources:[{id:'a',source:'a'}],query:'湖边',minimum:0});assert.equal(r.status,400);assert.equal(f.library.db.prepare('SELECT count(*) AS n FROM semantic_index').get()!.n,1);
 await assert.rejects(embed('湖边',config,async()=>{throw new DOMException('timeout','TimeoutError');},false),{name:'TimeoutError'});
 for(const bad of [{action:'index',source:'a'.repeat(2001),image},{action:'index',source:'b',image:'data:image/jpeg;base64,'+'A'.repeat(250000)},{action:'search',sources:[{id:'',source:'a'}],query:'湖',minimum:0},{action:'search',sources:[],query:'湖'.repeat(1001),minimum:0}])assert.equal((await f.request(bad)).status,400);
}finally{await f.close();}});
