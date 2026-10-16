import {useEffect,useMemo,useState} from 'react';
import type {Trip} from '../types';
import {layoutCandidates,layoutProposal,nearestCandidate} from '../auto-layout';
import {getMeasure} from '../export';
import type {Measure} from '../layout';
import {Modal,Paper} from './UI';
const names={spacious:'舒展 · 每页少量大图',balanced:'均衡 · 图文兼顾',compact:'紧凑 · 多图组合'};
export function AutoLayout({trip,onApply,onClose,notify}:{trip:Trip;onApply:(update:(t:Trip)=>Trip)=>void;onClose:()=>void;notify:(s:string,error?:boolean)=>void}){
 const [sort,setSort]=useState(!trip.chapters.length),[target,setTarget]=useState('20'),[chosen,setChosen]=useState(1),[measure,setMeasure]=useState<Measure>();
 useEffect(()=>{let alive=true;getMeasure().then(m=>{if(alive)setMeasure(()=>m);}).catch(e=>notify(e.message,true));return()=>{alive=false;};},[]);
 const options=useMemo(()=>measure?layoutCandidates(trip,sort,measure):[],[trip,sort,measure]);
 return <Modal title="自动排版，先比较再应用" onClose={onClose} wide><div className="modal-body"><p>根据画面横竖比例安排版式。正文、照片和锁定章节保留；重新排版会替换未锁定章节的模板与照片高度。</p><div className="button-row"><label>目标总页数（含封面）<input type="number" min="1" max="1000" value={target} onChange={e=>setTarget(e.target.value)}/></label><button className="button secondary" disabled={!options.length} onClick={()=>{try{setChosen(nearestCandidate(options.map(o=>o.pages.length),Number(target)));}catch(e){notify((e as Error).message,true);}}}>推荐最接近的版式</button><label><input type="checkbox" checked={sort} onChange={e=>setSort(e.target.checked)}/>未锁定章节内按拍摄时间重新排序</label></div>
 {!options.length&&<p>正在使用打印字体计算分页…</p>}<div className="layout-options">{options.map((option,i)=>{const preview=option.pages.find(p=>!p.cover)||option.pages[0];return <button className={`layout-option ${chosen===i?'chosen':''}`} key={option.density} aria-pressed={chosen===i} onClick={()=>setChosen(i)}><strong>{names[option.density]}</strong><span>{option.pages.length} 页</span><Paper page={preview} trip={option.trip} scale={.24}/></button>;})}</div>
 <p className="field-hint">目标页数用于挑选候选，不保证精确达到；不会自动删图或截断正文。已有章节外的精选素材仍需手动加入章节。首次成书会按站点、日期建立章节。</p></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>取消排版</button><button className="button primary" disabled={!options.length} onClick={()=>{onApply(t=>layoutProposal(t,options[chosen].density,sort));onClose();notify('已应用版式，锁定章节保留；可撤销或继续人工调整。');}}>应用所选版式</button></div></Modal>;
}
