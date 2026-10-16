import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Connect } from 'vite';
import { handleAI, handleTranscribe, handleBaidu } from './handlers';
import { handleSemantic } from './semantic';
import { MediaLibrary } from './library';
import { createLibraryHandler } from './library-http';
export function createAppServer(fallback:(req:IncomingMessage,res:ServerResponse)=>void,providedLibrary?:MediaLibrary) {
  let sharedLibrary=providedLibrary;
  const getLibrary=()=>sharedLibrary??=(new MediaLibrary());
  let libraryHandler:ReturnType<typeof createLibraryHandler>|undefined;
  return createServer(async(req,res)=>{
    const path=(req.url||'/').split('?')[0];
    if(!path.startsWith('/api/')){fallback(req,res);return;}
    const host=req.headers.host||'localhost:5173',origin=`http://${host}`;
    if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本地服务仅接受localhost地址访问。'}));return;}
    if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'请从应用页面发起请求。'}));return;}
    if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'请从本地应用页面访问素材。'}));return;}
    if(path==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',app:'xingji'}));return;}
    if(path.startsWith('/api/library/')){try{libraryHandler??=createLibraryHandler(getLibrary());await libraryHandler(req,res);}catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'无法打开本地资料库，请检查目录权限或设置TRAVEL_DATA_DIR。'}));}return;}
    if(req.method!=='POST'){res.writeHead(405,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'此接口仅接受POST请求。'}));return;}
    try{
      const limit=path==='/api/transcribe'?27*1024**2:2*1024**2;
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'请求内容过大，请分批处理。'}));return;}chunks.push(Buffer.from(chunk));}
      const request=new Request(origin+path,{method:'POST',headers: new Headers(Object.entries(req.headers).filter(([,v])=>typeof v==='string') as [string,string][]),body:Buffer.concat(chunks)});
      const response=path==='/api/semantic'?await handleSemantic(request,getLibrary(),fetch,true):path==='/api/ai'?await handleAI(request,fetch,true):path==='/api/transcribe'?await handleTranscribe(request,fetch,true):path==='/api/baidu'?await handleBaidu(request):new Response(JSON.stringify({error:'接口不存在。'}),{status:404,headers:{'Content-Type':'application/json'}});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body){const body=Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);body.on('error',()=>res.destroy());res.on('close',()=>body.destroy());body.pipe(res);}else res.end();
    }catch{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'服务暂时不可用，请重试。'}));}
  });
}
