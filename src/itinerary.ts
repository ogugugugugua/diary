import type { Asset, Chapter, Stop, Trip } from './types';

// Store camera wall time separately from its optional offset; never guess the host timezone.
export function cameraDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const result = value.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T').replace(' ', 'T').slice(0,19);
  return validDate(result) ? result : '';
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value)) return false;
  const normalized = value.length === 10 ? value+'T00:00:00' : value.length === 16 ? value+':00' : value;
  const time = Date.parse(normalized+'Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19) === normalized;
}
export const validOffset = (value: unknown): value is string => typeof value === 'string' && /^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(value);
export function captureKey(asset: Asset): number {
  if (!validDate(asset.date)) return Infinity;
  const date = asset.date.length === 10 ? asset.date+'T00:00:00' : asset.date;
  return Date.parse(date+(validOffset(asset.utcOffset) ? asset.utcOffset : 'Z'));
}
export function chronological(assets: Asset[]): Asset[] {
  return [...assets].sort((a,b) => {const x=captureKey(a),y=captureKey(b);return x===y ? 0 : x<y ? -1 : 1;});
}
export function suggestStops(trip: Trip): Stop[] {
  const assigned = new Set((trip.stops||[]).flatMap(s=>s.assetIds));
  const groups = new Map<string,Stop>();
  for (const asset of chronological(trip.assets.filter(a=>!assigned.has(a.id)))) {
    const date = asset.date.slice(0,10), location = asset.location.trim();
    const key = JSON.stringify([date,location]);
    if (!groups.has(key)) groups.set(key,{id:crypto.randomUUID(),title:location||'待补充地点',date,location,story:'',assetIds:[]});
    groups.get(key)!.assetIds.push(asset.id);
  }
  return [...groups.values()];
}
export function assignToStop(trip: Trip, ids: string[], target: string): Trip {
  const valid = new Set(trip.assets.map(a=>a.id)), selected=new Set(ids.filter(id=>valid.has(id)));
  if (target && !trip.stops?.some(s=>s.id===target)) return trip;
  return {...trip,stops:(trip.stops||[]).map(s=>({...s,assetIds:[...s.assetIds.filter(id=>!selected.has(id)),...(s.id===target?[...selected]:[])]}))};
}
export function chaptersFromStops(trip: Trip): Chapter[] {
  return (trip.stops||[]).map(stop=>({id:crypto.randomUUID(),title:[stop.date,stop.title].filter(Boolean).join(' · '),body:stop.story,
    assetIds:chronological(trip.assets.filter(a=>a.selected&&stop.assetIds.includes(a.id))).map(a=>a.id),
    layout:'balanced' as const,locked:false,stopIds:[stop.id]})).filter(c=>c.assetIds.length||c.body.trim());
}
export function remapStops(trip: Trip, assetIds: Map<string,string>): void {
  const stops=new Map((trip.stops||[]).map(s=>[s.id,crypto.randomUUID()]));
  trip.stops=trip.stops?.map(s=>({...s,id:stops.get(s.id)!,assetIds:s.assetIds.map(id=>assetIds.get(id)!).filter(Boolean)}));
  trip.chapters=trip.chapters.map(c=>({...c,stopIds:c.stopIds?.map(id=>stops.get(id)!).filter(Boolean)}));
}
