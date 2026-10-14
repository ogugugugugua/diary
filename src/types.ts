export type Layout = 'balanced' | 'album' | 'journal';
export interface Asset {
  id: string; name: string; kind: 'image' | 'video'; size: number;
  width: number; height: number; date: string; location: string;
  caption: string; selected: boolean; fingerprint: string;
  blobKey?: string; thumbnailKey?: string; src?: string; missing?: boolean;
  fit?: 'cover' | 'contain'; cropX?: number; cropY?: number;
}
export interface Fact { date: string; place: string; event: string; feeling: string; }
export interface Memory {
  id: string; text: string; assetId?: string; audioKey?: string;
  facts: Fact[]; uncertain: string[]; confirmed: boolean; createdAt: string;
}
export interface Chapter {
  id: string; title: string; body: string; assetIds: string[]; layout: Layout; locked: boolean;
  imageHeight?: number;
}
export interface Trip {
  id: string; title: string; subtitle: string; startDate: string; endDate: string;
  coverId?: string; assets: Asset[]; memories: Memory[]; chapters: Chapter[];
  margin: number; binding: number; tone: string; createdAt: string; updatedAt: string; demo?: boolean;
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
