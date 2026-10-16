import {createHash} from 'node:crypto';
import type {MediaLibrary} from './library';
import {handleAI,providerURL} from './handlers';
type Config={baseUrl:string;model:string;apiKey?:string};
type Source={id:string;source:string};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function config(value:unknown):Config{const c=value as Config;if(!c||typeof c.baseUrl!=='string'||typeof c.model!=='string'||!c.model.trim()||c.model.length>200)throw new Error('请配置视觉模型与文本向量模型。');return c;}
function key(c:Config){if(typeof c.apiKey!=='string'||!c.apiKey.trim()||c.apiKey.length>2000)throw new Error('请填写本次会话的模型密钥。');return c.apiKey;}
export function normalizeVector(value:unknown):number[]{if(!Array.isArray(value)||value.length<2||value.length>4096||!value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e10))throw new Error('向量响应格式不正确。');const norm=Math.hypot(...value);if(!Number.isFinite(norm)||norm<1e-12)throw new Error('模型返回了零向量。');return value.map(n=>n/norm);}
export function cosine(a:number[],b:number[]):number{if(a.length!==b.length)throw new Error('向量维度已变化，请清除当前模型索引后重建。');return Math.max(-1,Math.min(1,a.reduce((sum,n,i)=>sum+n*b[i],0)));}
export async function embed(text:string,c:Config,fetcher:typeof fetch,allowLocal:boolean){
 const address=providerURL(c.baseUrl,'embeddings',allowLocal),apiKey=key(c);
 const response=await fetcher(address,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:c.model,input:text,encoding_format:'float'}),redirect:'manual',signal:AbortSignal.timeout(60000)});
 if(!response.ok){await response.body?.cancel();throw new Error(`向量服务返回 HTTP ${response.status}，请检查模型、密钥或额度。`);}
 const reader=response.body?.getReader();if(!reader)throw new Error('向量服务没有返回内容。');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw new Error('向量响应过大。');}chunks.push(value);}
 let result:{data?:{index?:number;embedding?:unknown}[]};try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('向量服务没有返回有效JSON。');}
 if(!Array.isArray(result.data)||result.data.length!==1||(result.data[0].index!==undefined&&result.data[0].index!==0))throw new Error('向量响应数量或编号不正确。');
 return normalizeVector(result.data[0].embedding);
}
export async function handleSemantic(request:Request,library:MediaLibrary,fetcher:typeof fetch=fetch,allowLocal=false):Promise<Response>{
 try{
  const body=await request.json(),writer=config(body.writer),embedding=config(body.embedding);
  const namespace=createHash('sha256').update(JSON.stringify(['caption-vector-v1',providerURL(writer.baseUrl,'chat/completions',allowLocal).href,writer.model,providerURL(embedding.baseUrl,'embeddings',allowLocal).href,embedding.model])).digest('hex');
  library.db.exec('CREATE TABLE IF NOT EXISTS semantic_index(namespace TEXT NOT NULL,source TEXT NOT NULL,description TEXT NOT NULL,vector TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(namespace,source))');
  const sourceValid=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=2000;
  const get=library.db.prepare('SELECT description,vector FROM semantic_index WHERE namespace=? AND source=?');
  if(body.action==='index'){
   if(!sourceValid(body.source))throw new Error('素材来源编号不正确。');
   const existing=get.get(namespace,body.source);if(existing)return reply({indexed:true,cached:true});
   key(writer);key(embedding);
   if(typeof body.image!=='string'||body.image.length>=250000||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.image))throw new Error('请选择不超过250 KB编码长度的图片缩略图。');
   const response=await handleAI(new Request('http://localhost/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'describe',config:writer,data:{purpose:'为旅行照片生成中文场景索引'},images:[body.image]})}),fetcher,allowLocal);
   const result=await response.json();if(!response.ok)throw new Error(result.error||'场景描述失败。');
   const description=String(result.text||'').trim();if(!description||description.length>4000)throw new Error('场景描述为空或过长，请更换模型后重试。');
   const vector=await embed(description,embedding,fetcher,allowLocal);
   library.db.prepare('INSERT OR IGNORE INTO semantic_index VALUES(?,?,?,?,?)').run(namespace,body.source,description,JSON.stringify(vector),new Date().toISOString());
   return reply({indexed:true,cached:false});
  }
  if(!Array.isArray(body.sources)||body.sources.length>20000||!body.sources.every((s:Source)=>s&&typeof s.id==='string'&&s.id.length>0&&s.id.length<=100&&sourceValid(s.source)))throw new Error('素材范围不正确，最多支持2万个素材。');
  const sources=body.sources as Source[];
  if(body.action==='clear'){const remove=library.db.prepare('DELETE FROM semantic_index WHERE namespace=? AND source=?');for(const s of sources)remove.run(namespace,s.source);return reply({cleared:true});}
  if(body.action==='status')return reply({indexed:sources.filter(s=>!!get.get(namespace,s.source)).map(s=>s.id)});
  if(body.action!=='search')throw new Error('不支持的语义搜索操作。');
  if(typeof body.query!=='string'||!body.query.trim()||body.query.length>1000)throw new Error('请输入1至1000字的场景描述。');
  if(typeof body.minimum!=='number'||!Number.isFinite(body.minimum)||body.minimum<0||body.minimum>1)throw new Error('相关度阈值必须在0到1之间。');
  const exists=library.db.prepare('SELECT 1 FROM semantic_index WHERE namespace=? AND source=?');
  if(!sources.some(s=>!!exists.get(namespace,s.source)))return reply({results:[],indexed:0,unindexed:sources.length});
  const query=await embed(body.query.trim(),embedding,fetcher,allowLocal);
  const results:{id:string;description:string;score:number}[]=[];let indexed=0;
  for(const source of sources){const row=get.get(namespace,source.source) as {description:string;vector:string}|undefined;if(!row)continue;indexed++;const score=cosine(query,normalizeVector(JSON.parse(row.vector)));if(score<body.minimum)continue;results.push({id:source.id,description:row.description,score});results.sort((a,b)=>b.score-a.score);if(results.length>100)results.pop();}
  return reply({results,indexed,unindexed:sources.length-indexed});
 }catch(error){const message=error instanceof Error?error.message:'语义索引失败。';return reply({error:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'模型请求超时，已完成的索引保留，可重试。':message==='fetch failed'?'模型服务连接失败，请检查地址。':message},400);}
}
