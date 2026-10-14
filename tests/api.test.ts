import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI, handleBaidu, handleTranscribe, providerURL } from '../server/handlers';
const request=(path:string,body:unknown)=>new Request(`http://localhost:5173/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const config={baseUrl:'https://model.example/v1',model:'writer',apiKey:'fixture-key'};

test('云端地址禁止凭据、私有IP和不安全协议；本地服务可选择本地模型',()=>{
  for(const url of ['http://model.example','https://127.0.0.1','https://192.168.0.1','https://model.local','https://user:password@model.example','https://model.example?token=secret'])assert.throws(()=>providerURL(url,'chat/completions'));
  assert.equal(providerURL('http://localhost:11434/v1','chat/completions',true).href,'http://localhost:11434/v1/chat/completions');
});
test('提取请求使用用户配置，仅发送选定数据，不在响应中回显密钥',async()=>{
  let sent:Record<string,unknown>|undefined;
  const fetcher:typeof fetch=async(url,init)=>{assert.equal(String(url),'https://model.example/v1/chat/completions');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture-key');assert.equal(init?.redirect,'manual');sent=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:'{"facts":[],"uncertain":[]}'}}]});};
  const response=await handleAI(request('ai',{task:'extract',config,data:{text:'原始口述'}}),fetcher),result=await response.json();
  assert.equal(response.status,200);assert.ok(sent);assert.ok(!JSON.stringify(result).includes('fixture-key'));
});
test('无效任务和未配置密钥不会发出请求，401不回显上游响应内容',async()=>{
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response('credential echoed by remote fixture-key',{status:401});};
  assert.equal((await handleAI(request('ai',{task:'toString',config}),fetcher)).status,400);
  assert.equal((await handleAI(request('ai',{task:'test',config:{...config,apiKey:''}}),fetcher)).status,400);assert.equal(calls,0);
  const result=await (await handleAI(request('ai',{task:'test',config}),fetcher)).json();assert.match(result.error,/密钥/);assert.ok(!result.error.includes('fixture-key'));assert.equal(calls,1);
});
test('语音服务保持独立的模型、密钥与录音文件名',async()=>{
  const form=new FormData();form.set('file',new File(['audio fixture'],'voice.wav',{type:'audio/wav'}));form.set('apiKey','speech-key');form.set('baseUrl','https://speech.example/v1');form.set('model','asr');
  const response=await handleTranscribe(new Request('http://localhost:5173/api/transcribe',{method:'POST',body:form}),async(url,init)=>{assert.equal(String(url),'https://speech.example/v1/audio/transcriptions');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer speech-key');const sent=init?.body as FormData;assert.equal(sent.get('model'),'asr');assert.equal((sent.get('file') as File).name,'voice.wav');return Response.json({text:'一家人沿湖散步。'});});
  assert.equal((await response.json()).text,'一家人沿湖散步。');
});
test('网盘授权失败保留错误状态；授权码交换要求本站回调',async()=>{
  const response=await handleBaidu(request('baidu',{action:'list',token:'fixture-token',path:'/'}),async()=>Response.json({errno:110}));assert.equal(response.status,400);assert.match((await response.json()).error,/授权/);
  let called=false;const result=await handleBaidu(request('baidu',{action:'exchange',clientId:'id',clientSecret:'secret',code:'code',redirectUri:'https://elsewhere.example/baidu-callback'}),async()=>{called=true;return Response.json({access_token:'value'});});assert.equal(result.status,400);assert.equal(called,false);
});
test('网盘下载只跟随百度下载域，禁止把授权令牌发送到任意地址',async()=>{
  let calls=0;const response=await handleBaidu(request('baidu',{action:'download',token:'fixture-token',fileId:123}),async()=>{calls++;return Response.json({errno:0,list:[{dlink:'https://untrusted.example/file',size:20}]});});
  assert.equal(response.status,400);assert.equal(calls,1);assert.match((await response.json()).error,/下载地址/);
});
test('网盘下载以流返回文件，错误与超过大小限制时不产生成功文件',async()=>{
  let calls=0;const response=await handleBaidu(request('baidu',{action:'download',token:'fixture-token',fileId:123}),async(url)=>{calls++;if(calls===1)return Response.json({errno:0,list:[{dlink:'https://pcs.baidu.com/file',size:4}]});assert.equal(new URL(String(url)).searchParams.get('access_token'),'fixture-token');return new Response('data',{headers:{'Content-Type':'image/jpeg'}});});assert.equal(response.status,200);assert.equal(await response.text(),'data');
  const large=await handleBaidu(request('baidu',{action:'download',token:'fixture-token',fileId:123}),async()=>Response.json({errno:0,list:[{dlink:'https://pcs.baidu.com/file',size:600*1024**2}]}));assert.equal(large.status,413);
});
