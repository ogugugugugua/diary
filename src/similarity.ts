import type { Asset } from './types';
import { captureKey, chronological } from './itinerary';
export interface VisualIndex { source: string; hash: string; color: number[]; aspect: number; }
export const visualSource=(a:Asset)=>[a.fingerprint,a.source?.version||'',a.thumbnailKey||'',a.src||''].join('|');
export function differenceHash(rgba:ArrayLike<number>,width=9,height=8):string {
  if(width!==9||height!==8||rgba.length!==width*height*4)throw new Error('视觉指纹需要9×8像素。');
  const luminance=(i:number)=>rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114;
  let bits=0n;for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits=(bits<<1n)|(luminance((y*9+x)*4)>luminance((y*9+x+1)*4)?1n:0n);
  return bits.toString(16).padStart(16,'0');
}
export function hashDistance(a:string,b:string):number {let x=BigInt('0x'+a)^BigInt('0x'+b),n=0;while(x){x&=x-1n;n++;}return n;}
interface Node {hash:string; groups:Asset[][]; children:Map<number,Node>;}
// A metric tree avoids comparing every pair of images. Each group is checked against its representative.
export function similarGroups(assets:Asset[],threshold=8):Asset[][] {
  let root:Node|undefined;const result:Asset[][]=[];
  for(const a of assets){const v=a.visual;if(a.kind!=='image'||!v||v.source!==visualSource(a))continue;
    const candidates:Node[]=[],pending=root?[root]:[];
    while(pending.length){const node=pending.pop()!,distance=hashDistance(v.hash,node.hash);if(distance<=threshold)candidates.push(node);for(const [d,child]of node.children)if(d>=distance-threshold&&d<=distance+threshold)pending.push(child);}
    let group:Asset[]|undefined;
    for(const node of candidates){group=node.groups.find(g=>{const other=g[0].visual!;return Math.abs(Math.log(v.aspect/other.aspect))<.2&&Math.hypot(...v.color.map((c,i)=>c-other.color[i]))<65;});if(group)break;}
    if(group){group.push(a);continue;}
    group=[a];result.push(group);
    if(!root){root={hash:v.hash,groups:[group],children:new Map()};continue;}
    let node=root;while(true){const d=hashDistance(v.hash,node.hash);if(!d){node.groups.push(group);break;}const child=node.children.get(d);if(child)node=child;else{node.children.set(d,{hash:v.hash,groups:[group],children:new Map()});break;}}
  }
  return result.filter(g=>g.length>1);
}
export function burstGroups(assets:Asset[]):Asset[][] {
  const groups:Asset[][]=[];let current:Asset[]=[];
  for(const a of chronological(assets.filter(a=>a.kind==='image'&&a.date.length>=16))){const previous=current.at(-1);if(previous&&captureKey(a)-captureKey(previous)<=3000&&a.location===previous.location)current.push(a);else{if(current.length>1)groups.push(current);current=[a];}}
  if(current.length>1)groups.push(current);return groups;
}
export function validVisual(input:unknown):VisualIndex|undefined {
  if(!input||typeof input!=='object')return;
  const v=input as VisualIndex;
  if(typeof v.source!=='string'||v.source.length>2000||typeof v.hash!=='string'||! /^[0-9a-f]{16}$/.test(v.hash)||!Array.isArray(v.color)||v.color.length!==3||!v.color.every(c=>Number.isFinite(c)&&c>=0&&c<=255)||!Number.isFinite(v.aspect)||v.aspect<=0||v.aspect>100)return;
  return {source:v.source,hash:v.hash,color:v.color,aspect:v.aspect};
}
