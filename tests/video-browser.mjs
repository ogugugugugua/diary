import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
await mkdir('test-results',{recursive:true});
execFileSync('ffmpeg',['-y','-f','lavfi','-i','color=c=red:s=640x360:d=1','-f','lavfi','-i','color=c=blue:s=640x360:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','test-results/video.mp4'],{stdio:'ignore'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const centerColor=()=>page.evaluate(()=>{const image=document.querySelector('.asset-card img');if(!image||!image.naturalWidth)return null;const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,image.naturalWidth/2,image.naturalHeight/2,1,1,0,0,1,1);return Array.from(context.getImageData(0,0,1,1).data);});
try{
 await page.goto('http://localhost:5173/',{waitUntil:'networkidle'});await page.getByRole('button',{name:'新建游记',exact:true}).click();await page.getByLabel('游记标题',{exact:true}).fill('视频关键帧游记');await page.getByRole('button',{name:'创建游记',exact:true}).click();
 await page.locator('.assets-panel input[type=file]').setInputFiles('test-results/video.mp4');await page.getByText('1 个素材已导入',{exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'继续整理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.asset-card img')?.naturalWidth>0);
 const red=await centerColor();assert.ok(red[0]>200&&red[2]<40);
 await page.getByRole('button',{name:'查看video.mp4',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('关键帧时间（秒）',{exact:true}).fill('1.5');await dialog.getByRole('button',{name:'提取此帧',exact:true}).click();await page.getByText('已更新用于打印的视频关键帧。',{exact:true}).waitFor();await dialog.getByRole('button',{name:'保存信息',exact:true}).click();await page.waitForFunction(()=>{const image=document.querySelector('.asset-card img');if(!image?.naturalWidth)return false;const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,image.naturalWidth/2,image.naturalHeight/2,1,1,0,0,1,1);const data=context.getImageData(0,0,1,1).data;return data[2]>200&&data[0]<40;});
 await page.getByRole('button',{name:/3 编辑游记/}).click();await page.getByRole('button',{name:'按时间建立章节',exact:true}).click();await page.getByLabel('正文',{exact:true}).fill('视频里的一帧，也能留在纸上。');await page.locator('.editor-canvas .paper').waitFor({timeout:60000});
 const downloadPromise=page.waitForEvent('download',{timeout:90000});await page.locator('.trip-heading').getByRole('button',{name:'导出PDF',exact:true}).click();await page.getByRole('dialog',{name:'导出前，再检查一下'}).waitFor();assert.ok(await page.getByText(/DPI，建议换用更清晰/).isVisible());await page.getByRole('button',{name:'仍然导出PDF',exact:true}).click();await(await downloadPromise).saveAs('test-results/video-journal.pdf');const pdf=await PDFDocument.load(await readFile('test-results/video-journal.pdf'));assert.equal(pdf.getPageCount(),2);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',checks:['MP4本地导入','自动生成关键帧','选择不同时间的关键帧','更新后的缩略图及时显示','低清晰度导出检查','视频关键帧进入A4 PDF'],pages:pdf.getPageCount(),errors}));
}catch(error){await page.screenshot({path:'test-results/video-failure.png',fullPage:true});throw error;}finally{await browser.close();}
