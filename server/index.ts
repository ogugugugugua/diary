import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createAppServer } from './http';
const root=resolve('dist');
const contentTypes:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.otf':'font/otf','.ttf':'font/ttf','.woff2':'font/woff2','.txt':'text/plain'};
const server=createAppServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname),file=resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(400);res.end();return;}
    let target=file;try{if(!(await stat(file)).isFile())target=resolve(root,'index.html');}catch{target=extname(pathname)&&pathname!=='/baidu-callback'?file:resolve(root,'index.html');}
    const data=await readFile(target);res.writeHead(200,{'Content-Type':contentTypes[extname(target)]||'application/octet-stream','Cache-Control':target.endsWith('index.html')?'no-cache':'public, max-age=3600'});res.end(data);
  }catch{res.writeHead(404);res.end('文件不存在');}
});
const port=Number(process.env.TRAVEL_PORT)||5173;
server.listen(port,'127.0.0.1',()=>console.log(`行迹已启动：http://localhost:${port}`));
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
