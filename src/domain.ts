import { validVisual } from './similarity';
import { chronological, validDate, validOffset } from './itinerary';
import type { Asset, Chapter, Fact, Layout, Memory, Trip } from './types';

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const formatDate = (date: string) => date ? date.slice(0, 10).replaceAll('-', '.') : '日期待补充';
export const tripDates = (trip: Trip) => trip.startDate ? `${formatDate(trip.startDate)}${trip.endDate && trip.endDate !== trip.startDate ? ` — ${formatDate(trip.endDate)}` : ''}` : '留给下一次出发';
export const fileSize = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
export const selectedAssets = (trip: Trip) => trip.assets.filter(a => a.selected);
export function createTrip(title: string, startDate = '', endDate = ''): Trip {
  return { id: id(), title: title.trim() || '我的新旅行', subtitle: '', startDate, endDate,
    assets: [], memories: [], chapters: [], margin: 20, binding: 0, tone: '个人日记', createdAt: now(), updatedAt: now() };
}
export function chaptersFromAssets(trip: Trip): Chapter[] {
  const groups = new Map<string, Asset[]>();
  for (const asset of chronological(selectedAssets(trip))) {
    const day = asset.date.slice(0, 10) || '待补充日期';
    groups.set(day, [...(groups.get(day) ?? []), asset]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, assets], index) => ({
    id: id(), title: day === '待补充日期' ? '旅途中的片刻' : `第 ${index + 1} 天 · ${formatDate(day)}`,
    body: '', assetIds: assets.map(a => a.id), layout: 'balanced', locked: false,
  }));
}
export function mergeGeneratedChapters(previous: Chapter[], incoming: Chapter[]): Chapter[] {
  const used = new Set<number>();
  const result = previous.map((chapter, index) => {
    let target = incoming.findIndex((candidate, i) => !used.has(i) && candidate.title === chapter.title);
    if (target < 0 && index < incoming.length && !used.has(index)) target = index;
    if (target >= 0) used.add(target);
    if (chapter.locked || target < 0) return chapter;
    return { ...incoming[target], id: chapter.id, stopIds: chapter.stopIds, locked: false };
  });
  return [...result, ...incoming.filter((_, index) => !used.has(index))];
}
const clean = (value: unknown, max = 20000): string => {if(typeof value!=='string')return '';if(value.length>max)throw new Error('项目中的一段内容过长，请拆分后重试；原始内容会保留。');return value.replace(/\u0000/g,'');};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const array = (v: unknown, max = 1000): unknown[] => {if(!Array.isArray(v))return [];if(v.length>max)throw new Error('项目内容超过当前支持范围，请拆分为多本游记后重试。');return v;};
const number = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;
export function validateTrip(input: unknown): Trip {
  const t = record(input);
  if (typeof t.title !== 'string' || !Array.isArray(t.assets) || !Array.isArray(t.chapters)) throw new Error('项目文件格式不正确。');
  const assets: Asset[] = array(t.assets,20000).map(value => {
    const a = record(value);
    const source=record(a.source),sourceId=clean(source.id,100),sourceVersion=clean(source.version,100);
    return { id: clean(a.id, 100) || id(), name: clean(a.name, 512), kind: a.kind === 'video' ? 'video' : 'image',
      size: number(a.size), width: number(a.width), height: number(a.height), date: validDate(clean(a.date,30)) ? clean(a.date,30) : '', utcOffset: validOffset(a.utcOffset) ? a.utcOffset : undefined,
      location: clean(a.location, 250), caption: clean(a.caption, 1000), selected: a.selected !== false,
      rating:Math.min(5,Math.floor(number(a.rating))),tags:[...new Set(array(a.tags,30).map(t=>clean(t,80)).filter(Boolean))],visual:validVisual(a.visual),
      fingerprint: clean(a.fingerprint, 1000), blobKey: clean(a.blobKey, 150) || undefined,
      thumbnailKey: clean(a.thumbnailKey, 150) || undefined,
      src: typeof a.src === 'string' && /^\/images\/[a-z-]+\.jpg$/.test(a.src) ? a.src : undefined,
      missing: a.missing === true, fit: a.fit === 'contain' ? 'contain' : 'cover', cropX: Math.min(100,number(a.cropX,50)), cropY: Math.min(100,number(a.cropY,50)),
      source: ['local','baidu','legacy'].includes(String(source.kind))&&/^[A-Za-z0-9_-]+$/.test(sourceId)&&/^[A-Za-z0-9_-]+$/.test(sourceVersion)?{kind:source.kind as 'local'|'baidu'|'legacy',id:sourceId,version:sourceVersion,rootName:clean(source.rootName,300),path:clean(source.path,2000)}:undefined,
      renderWidth:number(a.renderWidth)||undefined,renderHeight:number(a.renderHeight)||undefined };
  });
  if (new Set(assets.map(a => a.id)).size !== assets.length) throw new Error('素材编号重复，无法恢复项目。');
  const assetIds = new Set(assets.map(a => a.id));
  const assigned=new Set<string>();
  const stops=array(t.stops,1000).map(value=>{const s=record(value);return {id:clean(s.id,100)||id(),title:clean(s.title,300),date:validDate(clean(s.date,30))?clean(s.date,30).slice(0,10):'',location:clean(s.location,250),story:clean(s.story,100000),assetIds:array(s.assetIds,20000).filter((a):a is string=>{if(typeof a!=='string'||!assetIds.has(a)||assigned.has(a))return false;assigned.add(a);return true;})};});
  if(new Set(stops.map(s=>s.id)).size!==stops.length)throw new Error('行程站点编号重复。');
  const stopIds=new Set(stops.map(s=>s.id));
  const chapters: Chapter[] = array(t.chapters, 300).map(value => {
    const c = record(value);
    return { id: clean(c.id, 100) || id(), title: clean(c.title, 300), body: clean(c.body, 100000),
      assetIds: array(c.assetIds,20000).filter((a): a is string => typeof a === 'string' && assetIds.has(a)),
      layout: (['balanced', 'album', 'journal', 'adaptive'].includes(String(c.layout)) ? c.layout : 'balanced') as Layout, locked: c.locked === true,
      density:c.density==='spacious'||c.density==='compact'?c.density:'balanced',
      stopIds: array(c.stopIds,1000).filter((s):s is string=>typeof s==='string'&&stopIds.has(s)),
      imageHeight: typeof c.imageHeight === 'number' ? Math.max(40,Math.min(110,c.imageHeight)) : undefined };
  });
  const memories: Memory[] = array(t.memories, 500).map(value => {
    const m = record(value);
    return { id: clean(m.id, 100) || id(), text: clean(m.text, 100000), assetId: assetIds.has(String(m.assetId)) ? String(m.assetId) : undefined,
      audioKey: clean(m.audioKey, 150) || undefined, confirmed: m.confirmed === true,
      createdAt: clean(m.createdAt, 40) || now(), uncertain: array(m.uncertain, 100).map(u => clean(u, 1000)),
      facts: array(m.facts, 200).map(value => { const f = record(value); return { date: clean(f.date, 30), place: clean(f.place, 300), event: clean(f.event, 3000), feeling: clean(f.feeling, 1000) } satisfies Fact; }) };
  });
  return { id: clean(t.id, 100) || id(), title: clean(t.title, 300), subtitle: clean(t.subtitle, 1000), startDate: clean(t.startDate, 30), endDate: clean(t.endDate, 30),
    stops, coverId: assetIds.has(String(t.coverId)) ? String(t.coverId) : undefined, assets, memories, chapters,
    margin: Math.min(30, Math.max(12, number(t.margin, 20))), binding: Math.min(15, number(t.binding)), tone: clean(t.tone, 100) || '个人日记',
    createdAt: clean(t.createdAt, 40) || now(), updatedAt: clean(t.updatedAt, 40) || now(), demo: t.demo === true };
}
export function parseAIJson(content: string): Record<string, unknown> {
  const stripped = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); } catch { throw new Error('模型返回的内容无法解析，请重试或换用支持JSON输出的模型。'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回的结构不正确。');
  return parsed as Record<string, unknown>;
}
export function parseExtracted(content: string): {facts: Fact[]; uncertain: string[]} {
  const data = parseAIJson(content);
  if (!Array.isArray(data.facts)) throw new Error('提取结果缺少事实列表。');
  return { facts: data.facts.slice(0, 100).map(value => { const f = record(value); return { date: clean(f.date, 30), place: clean(f.place, 300), event: clean(f.event, 3000), feeling: clean(f.feeling, 1000) }; }),
    uncertain: array(data.uncertain, 100).map(v => clean(v, 1000)) };
}
export function parseGenerated(content: string, trip: Trip): Chapter[] {
  const data = parseAIJson(content);
  if (!Array.isArray(data.chapters) || !data.chapters.length) throw new Error('模型没有返回章节，请补充回忆后重试。');
  const allowed = new Set(selectedAssets(trip).map(a => a.id));
  return data.chapters.slice(0, 50).map(value => { const c = record(value); return {
    id: id(), title: clean(c.title, 300) || '旅途片刻', body: clean(c.body, 30000),
    assetIds: array(c.assetIds).filter((a): a is string => typeof a === 'string' && allowed.has(a)), layout: 'balanced', locked: false,
  }; });
}
