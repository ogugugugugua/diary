import { createServer } from 'vite';
import { createAppServer } from './http';
const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
const server=createAppServer((req,res)=>vite.middlewares(req,res));
const port=Number(process.env.TRAVEL_PORT)||5173;
server.listen(port,'127.0.0.1',()=>console.log(`行迹已启动：http://localhost:${port}`));
async function shutdown(){server.close();await vite.close();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
