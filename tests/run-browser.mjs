import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'xingji-browser-regression-'));
function run(file){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{env:process.env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));});}
const server=spawn(process.execPath,['--import','tsx','server/dev.ts'],{env:{...process.env,TRAVEL_DATA_DIR:directory},stdio:['ignore','pipe','inherit']});
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server startup timed out')),20000);server.stdout.on('data',data=>{if(data.toString().includes('行迹已启动')){clearTimeout(timer);resolve();}});server.on('error',reject);});
 for(const file of (process.argv.length>2?process.argv.slice(2):['tests/browser.mjs','tests/video-browser.mjs','tests/storage-browser.mjs']))await run(file);
}finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));}
if(process.argv.length===2)await run('tests/features-browser.mjs');
