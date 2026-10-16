import type {Chapter,Trip} from './types';
import {chaptersFromAssets} from './domain';
import {chaptersFromStops,chronological} from './itinerary';
import {paginate,type Measure,approximateMeasure} from './layout';
export type Density='spacious'|'balanced'|'compact';
export function layoutProposal(trip:Trip,density:Density,sort=false):Trip {
 let chapters:Chapter[]=trip.chapters;
 if(!chapters.length){const stops=chaptersFromStops(trip),used=new Set(stops.flatMap(c=>c.assetIds));chapters=[...stops,...chaptersFromAssets({...trip,assets:trip.assets.filter(a=>!used.has(a.id))})];}
 const lookup=new Map(trip.assets.map(a=>[a.id,a]));
 return {...trip,chapters:chapters.map(c=>{
  if(c.locked)return c;
  const assetIds=sort?chronological(c.assetIds.map(id=>lookup.get(id)).filter((a):a is NonNullable<typeof a>=>!!a)).map(a=>a.id):c.assetIds;
  return {...c,assetIds,layout:'adaptive',density,imageHeight:undefined};
 })};
}
export function layoutCandidates(trip:Trip,sort=false,measure:Measure=approximateMeasure){
 return (['spacious','balanced','compact'] as Density[]).map(density=>{const proposal=layoutProposal(trip,density,sort);return {density,trip:proposal,pages:paginate(proposal,measure)};});
}
export function nearestCandidate(counts:number[],target:number):number {
 if(!Number.isInteger(target)||target<1||target>1000)throw new Error('目标页数须为1至1000的整数。');
 return counts.reduce((best,n,i)=>Math.abs(n-target)<Math.abs(counts[best]-target)?i:best,0);
}
