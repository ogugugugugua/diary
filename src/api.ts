import type { Settings, Secrets, Trip, Memory } from './types';
import { selectedAssets } from './domain';
import { visionImages } from './media';
async function responseJSON(response:Response){let result:{error?:string;text?:string};try{result=await response.json();}catch{throw new Error('服务返回内容异常，请确认本地服务正在运行。');}if(!response.ok)throw new Error(result.error||'请求失败。');return result;}
export async function runAI(task:'extract'|'generate'|'test',data:unknown,settings:Settings,secrets:Secrets,trip?:Trip):Promise<string>{
  if(!secrets.writerKey.trim())throw new Error('请先在“模型与连接”填写写作模型密钥。');
  const images=task==='generate'&&settings.vision&&trip?await visionImages(selectedAssets(trip)):undefined;
  const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task,data,config:{...settings.writer,apiKey:secrets.writerKey},images})});
  const result=await responseJSON(response);return result.text||'';
}
export function generationInput(trip:Trip){return {title:trip.title,tone:trip.tone,dates:[trip.startDate,trip.endDate],
  memories:trip.memories.filter(m=>m.confirmed).map(m=>({text:m.text,facts:m.facts,assetId:m.assetId})),
  assets:selectedAssets(trip).map(a=>({id:a.id,date:a.date,place:a.location,caption:a.caption,kind:a.kind})),
  existingChapters:trip.chapters.map(c=>({title:c.title,locked:c.locked}))};}
export async function transcribe(file:Blob,settings:Settings,secrets:Secrets):Promise<string>{
  if(!secrets.speechKey.trim())throw new Error('请先在“模型与连接”填写语音模型密钥。');
  if(file.size>25*1024**2)throw new Error('单次录音暂限25 MB，请分段处理。');
  const extension=file.type.includes('mp4')?'m4a':file.type.includes('mpeg')?'mp3':file.type.includes('wav')?'wav':file.type.includes('ogg')?'ogg':file.type.includes('flac')?'flac':'webm';
  const form=new FormData();form.set('file',file,file instanceof File?file.name:`recording.${extension}`);
  form.set('baseUrl',settings.speech.baseUrl);form.set('model',settings.speech.model);form.set('apiKey',secrets.speechKey);
  return (await responseJSON(await fetch('/api/transcribe',{method:'POST',body:form}))).text||'';
}
export async function baiduRequest<T>(body:unknown):Promise<T>{const response=await fetch('/api/baidu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return await responseJSON(response) as T;}
