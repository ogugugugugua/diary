import {useEffect,useMemo,useRef,useState} from 'react';
import type {Asset,Trip} from '../types';
import {assetBlob} from '../media';
import {burstGroups,differenceHash,similarGroups,visualSource,type VisualIndex} from '../similarity';
import {AssetPicture,Modal} from './UI';
import {useAssetURL} from '../hooks';

export function Rating({asset,onChange}:{asset:Asset;onChange:(patch:Partial<Asset>)=>void}){
 return <div className="rating-fields"><label>评级<select aria-label={`评级${asset.name}`} value={asset.rating||0} onChange={e=>onChange({rating:Number(e.target.value)})}>{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n?'★'.repeat(n):'未评级'}</option>)}</select></label><label>标签（逗号分隔）<input aria-label={`标签${asset.name}`} key={asset.id+(asset.tags||[]).join(',')} defaultValue={(asset.tags||[]).join(', ')} onBlur={e=>onChange({tags:[...new Set(e.target.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean))].slice(0,30)})}/></label></div>;
}
async function visualIndex(asset:Asset):Promise<VisualIndex>{
 const blob=await assetBlob(asset,false,'thumb');if(!blob)throw new Error('画面不可用');const bitmap=await createImageBitmap(blob);
 try{const canvas=document.createElement('canvas');canvas.width=9;canvas.height=8;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('浏览器不支持画面分析');ctx.drawImage(bitmap,0,0,9,8);const pixels=ctx.getImageData(0,0,9,8).data;
 const color=[0,0,0];for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)color[c]+=pixels[i+c]/72;
 return {source:visualSource(asset),hash:differenceHash(pixels),color,aspect:bitmap.width/bitmap.height};}finally{bitmap.close();}
}
export function Curation({trip,onChange,notify}:{trip:Trip;onChange:(fn:(t:Trip)=>Trip)=>void;notify:(text:string,error?:boolean)=>void}){
 const [busy,setBusy]=useState(''),[failures,setFailures]=useState<string[]>([]),[mode,setMode]=useState('similar'),[threshold,setThreshold]=useState(8),[compare,setCompare]=useState<string[]>([]),[groupPage,setGroupPage]=useState(0);const cancel=useRef(false);
 useEffect(()=>()=>{cancel.current=true;},[]);
 const groups=useMemo(()=>mode==='similar'?similarGroups(trip.assets,threshold):burstGroups(trip.assets),[trip.assets,mode,threshold]);
 const indexed=trip.assets.filter(a=>a.visual?.source===visualSource(a)).length;
 const build=async()=>{cancel.current=false;setFailures([]);const errors:string[]=[];const queue=trip.assets.filter(a=>a.kind==='image'&&a.visual?.source!==visualSource(a));let batch=new Map<string,VisualIndex>();
 const flush=()=>{const patch=batch;batch=new Map();onChange(t=>({...t,assets:t.assets.map(a=>{const v=patch.get(a.id);return v&&v.source===visualSource(a)?{...a,visual:v}:a;})}));};
 for(let i=0;i<queue.length&&!cancel.current;i++){setBusy(`本地分析 ${i+1} / ${queue.length} · ${queue[i].name}`);try{const v=await visualIndex(queue[i]);if(!cancel.current)batch.set(queue[i].id,v);}catch(e){errors.push(`${queue[i].name}：${(e as Error).message}`);}if(batch.size>=20)flush();await new Promise(r=>setTimeout(r,0));}
 if(batch.size)flush();setFailures(errors);setBusy('');notify(cancel.current?'已停止，已完成的索引保留。':`分析完成，${errors.length} 项未成功。`);};
 return <details className="organize-panel"><summary>精选与比较 · 已分析 {indexed} 张</summary><p className="field-hint">在本机分析画面结构、颜色和比例，寻找近似候选。相似分组可能误判，不自动删除或取消照片。连拍候选依据同地点相邻拍摄间隔不超过3秒。</p>
 <div className="button-row"><button className="button secondary" disabled={!!busy} onClick={()=>void build()}>分析未索引照片</button>{busy&&<button className="button secondary" onClick={()=>{cancel.current=true;}}>停止分析</button>}<span role="status">{busy}</span><label>分组方式<select value={mode} onChange={e=>{setMode(e.target.value);setGroupPage(0);}}><option value="similar">视觉相似</option><option value="burst">连拍候选</option></select></label>{mode==='similar'&&<label>相似容差<select value={threshold} onChange={e=>setThreshold(Number(e.target.value))}><option value={4}>严格</option><option value={8}>标准</option><option value={12}>宽松</option></select></label>}</div>
 {failures.length>0&&<details><summary>{failures.length} 个失败项，修复后可再次分析</summary>{failures.map((f,i)=><p key={i}>{f}</p>)}</details>}
 <div className="similar-groups">{groups.slice(groupPage*20,groupPage*20+20).map((group,i)=><div className="similar-group" key={group[0].id}><strong>候选组 {groupPage*20+i+1} · {group.length} 张</strong><div>{group.slice(0,6).map(a=><AssetPicture key={a.id} asset={a}/>)}</div><button className="button secondary" onClick={()=>setCompare(group.map(a=>a.id))}>并排比较这一组</button></div>)}</div>
 {!groups.length&&<p className="field-hint">暂无候选组。也可以在照片详情中手动评级和添加标签。</p>}{groups.length>20&&<div className="button-row"><button disabled={!groupPage} onClick={()=>setGroupPage(p=>p-1)}>上一组</button><button disabled={(groupPage+1)*20>=groups.length} onClick={()=>setGroupPage(p=>p+1)}>下一组</button></div>}
 {compare.length>1&&<Compare assets={compare.map(id=>trip.assets.find(a=>a.id===id)!).filter(Boolean)} onClose={()=>setCompare([])} onChange={(id,patch)=>onChange(t=>({...t,assets:t.assets.map(a=>a.id===id?{...a,...patch}:a)}))}/>}
 </details>;
}
function CompareImage({asset,zoom,x,y}:{asset:Asset;zoom:number;x:number;y:number}){const src=useAssetURL(asset,true);return <div className="compare-image">{src?<img src={src} alt={asset.name} style={{transform:`scale(${zoom})`,transformOrigin:`${x}% ${y}%`}}/>:<AssetPicture asset={asset}/>}</div>;}
function Compare({assets,onClose,onChange}:{assets:Asset[];onClose:()=>void;onChange:(id:string,patch:Partial<Asset>)=>void}){
 const [left,setLeft]=useState(assets[0].id),[right,setRight]=useState(assets[1].id),[zoom,setZoom]=useState(1),[x,setX]=useState(50),[y,setY]=useState(50);
 return <Modal title="并排选片" onClose={onClose} wide><div className="button-row compare-controls"><label>同步放大<input type="range" min="1" max="5" step=".25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><label>查看水平位置<input type="range" value={x} onChange={e=>setX(Number(e.target.value))}/></label><label>查看垂直位置<input type="range" value={y} onChange={e=>setY(Number(e.target.value))}/></label></div><div className="compare-columns">{[left,right].map((id,i)=>{const a=assets.find(a=>a.id===id)||assets[i];return <section key={i}><select aria-label={i?'右侧照片':'左侧照片'} value={a.id} onChange={e=>(i?setRight:setLeft)(e.target.value)}>{assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><CompareImage asset={a} zoom={zoom} x={x} y={y}/><p>{a.date||'时间待补充'} · {a.width} × {a.height}</p><Rating asset={a} onChange={patch=>onChange(a.id,patch)}/><button className={`button ${a.selected?'primary':'secondary'}`} aria-pressed={a.selected} onClick={()=>onChange(a.id,{selected:!a.selected})}>{a.selected?'已入选游记 · 点击取消':'选入游记'}</button></section>;})}</div><p className="field-hint compare-note">两侧同步放大查看原图；评级、标签和入选状态分别保存，不修改原文件。</p></Modal>;
}
