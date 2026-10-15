import type { VisualIndex } from './similarity';
export type Layout = 'balanced' | 'album' | 'journal';
export interface Stop { id: string; title: string; date: string; location: string; story: string; assetIds: string[]; }
export interface Asset {
  id: string; name: string; kind: 'image' | 'video'; size: number;
  width: number; height: number; date: string; location: string;
  utcOffset?: string; rating?: number; tags?: string[]; visual?: VisualIndex;
  caption: string; selected: boolean; fingerprint: string;
  blobKey?: string; thumbnailKey?: string; src?: string; missing?: boolean;
  fit?: 'cover' | 'contain'; cropX?: number; cropY?: number;
  source?: { kind: 'local' | 'baidu' | 'legacy'; id: string; version: string; rootName?: string; path?: string };
  renderWidth?: number; renderHeight?: number;
}
export interface Fact { date: string; place: string; event: string; feeling: string; }
export interface Memory {
  id: string; text: string; assetId?: string; audioKey?: string;
  facts: Fact[]; uncertain: string[]; confirmed: boolean; createdAt: string;
}
export interface Chapter {
  id: string; title: string; body: string; assetIds: string[]; layout: Layout; locked: boolean;
  imageHeight?: number; stopIds?: string[];
}
export interface Trip {
  id: string; title: string; subtitle: string; startDate: string; endDate: string;
  stops?: Stop[];
  coverId?: string; assets: Asset[]; memories: Memory[]; chapters: Chapter[];
  margin: number; binding: number; tone: string; createdAt: string; updatedAt: string; demo?: boolean;
  storageRevision?: number;
}
export interface Provider { baseUrl: string; model: string; }
export interface Settings { writer: Provider; speech: Provider; vision: boolean; }
export interface Secrets { writerKey: string; speechKey: string; baiduToken: string; }
export interface TextBlock { type: 'text'; x: number; y: number; text: string; size: number; color?: string; }
export interface ImageBlock { type: 'image'; x: number; y: number; width: number; height: number; assetId: string; }
export interface Page { chapterId: string; title: string; cover?: boolean; blocks: (TextBlock | ImageBlock)[]; }
export const defaultSettings: Settings = {
  writer: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  speech: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' }, vision: false,
};
