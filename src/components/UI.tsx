import {VideoQR} from './VideoQR';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ImageOff, X } from 'lucide-react';
import type { Asset, Page, Trip } from '../types';
import { useAssetURL } from '../hooks';

export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const titleId=useId(),ref=useRef<HTMLDivElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const panel=ref.current;
    const targets=()=>Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')||[]);
    targets()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')closeRef.current();if(e.key==='Tab'){const all=targets(),first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',key);const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={`modal ${wide?'modal-wide':''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={20}/></button></div>{children}
  </div></div>;
}
export function AssetPicture({asset,className='',style,print=false}:{asset?:Asset;className?:string;style?:React.CSSProperties;print?:boolean}){
  const src=useAssetURL(asset,false,print?'print':'thumb');return src?<img className={className} src={src} alt={asset?.caption||asset?.name||'旅行照片'} style={{objectFit:asset?.fit||'cover',objectPosition:`${asset?.cropX??50}% ${asset?.cropY??50}%`,...style}} loading="lazy"/>:<div className={`image-placeholder ${className}`} style={style}><ImageOff size={26}/><span>{asset?.missing?'素材待关联':'暂无画面'}</span></div>;
}
function PaperImage({asset,style}:{asset?:Asset;style:React.CSSProperties}){return <AssetPicture asset={asset} className="paper-image" style={style} print/>;}
export function Paper({page,trip,scale=0.65}:{page:Page;trip:Trip;scale?:number}){
  return <div className="paper-shell" style={{width:`${210*scale}mm`,height:`${297*scale}mm`}}><div className="paper" style={{transform:`scale(${scale})`}}>
    {page.blocks.map((block,index)=>block.type==='text'?<div key={index} className="paper-text" style={{left:`${block.x}mm`,top:`${block.y}mm`,fontSize:`${block.size}pt`,color:block.color}}>{block.text}</div>:block.type==='qr'?<VideoQR key={index} url={block.url} style={{position:'absolute',left:`${block.x}mm`,top:`${block.y}mm`,width:`${block.width}mm`,height:`${block.height}mm`}}/>:<PaperImage key={index} asset={trip.assets.find(a=>a.id===block.assetId)} style={{left:`${block.x}mm`,top:`${block.y}mm`,width:`${block.width}mm`,height:`${block.height}mm`}}/>)}
  </div></div>;
}
export function ResponsivePaper({page,trip}:{page:Page;trip:Trip}){
  const ref=useRef<HTMLDivElement>(null),[scale,setScale]=useState(.6);
  useEffect(()=>{const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width||500;setScale(Math.min(.82,Math.max(.24,(width-40)/793.7)));});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
  return <div ref={ref} className="responsive-paper"><Paper page={page} trip={trip} scale={scale}/></div>;
}
export function Empty({icon,heading,children}:{icon:ReactNode;heading:string;children:ReactNode}){return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{heading}</h3><div className="muted">{children}</div></div>;}
