import type { Trip, Asset, Chapter } from './types';
const date = '2026-10-01T12:00:00.000Z';
const photos = (prefix: string, sources: string[], dates: string[]): Asset[] => sources.map((src, i) => ({
  id: `${prefix}-photo-${i}`, name: `示例照片 ${i + 1}.jpg`, kind: 'image', src: `/images/${src}.jpg`,
  size: 0, width: 1600, height: src === 'road' ? 1104 : 1067, date: dates[i % dates.length], location: '',
  caption: ['让脚步慢下来，听见风的声音。', '旅途中的风景，值得多停留一会儿。', '把这一刻留给未来的我们。'][i % 3], selected: true, fingerprint: `sample-${prefix}-${i}`,
}));
const assets = photos('dali', ['lake', 'mountains', 'road', 'lake', 'mountains', 'coast'], ['2026-09-18', '2026-09-18', '2026-09-19', '2026-09-19', '2026-09-20', '2026-09-20']);
const chapters: Chapter[] = [
  { id: 'demo-day-1', title: '第一天 · 风从湖面吹来', body: '离开熟悉的日常，终于有时间好好看看眼前的风景。我们沿着湖边慢慢走，没有赶路，也没有一定要到达的目的地。\n\n傍晚的光落在水面上，风把远处的声音送过来。旅行最好的部分，也许就是一家人一起，把普通的一天过得特别一点。', assetIds: assets.slice(0, 2).map(a => a.id), layout: 'balanced', locked: false },
  { id: 'demo-day-2', title: '第二天 · 走进绿色里', body: '今天把时间留给了山间的小路。沿途的树木、脚下的落叶，还有偶尔停下来休息的片刻，都成了回忆的一部分。\n\n翻看照片时，想起的不只是风景，也是一同出发的人。', assetIds: assets.slice(2, 4).map(a => a.id), layout: 'album', locked: false },
  { id: 'demo-day-3', title: '第三天 · 把风景带回家', body: '最后一天，我们又去看了一次远处的山。临走前拍的照片，像一个小小的句号。\n\n旅程会结束，回忆可以慢慢整理。下次翻开这本游记，希望还能想起当时的风。', assetIds: assets.slice(4).map(a => a.id), layout: 'balanced', locked: false },
];
export const demoTrips: Trip[] = [
  { id: 'demo-dali', title: '山海之间，慢一点', subtitle: '三天两夜，和家人一起收集风景。', startDate: '2026-09-18', endDate: '2026-09-20', coverId: assets[0].id,
    assets, memories: [], chapters, margin: 20, binding: 0, tone: '家庭旅行', createdAt: date, updatedAt: date, demo: true },
  { id: 'demo-coast', title: '去海边，听风', subtitle: '留一页给夏天，留一页给我们。', startDate: '2026-08-08', endDate: '2026-08-09', coverId: 'coast-photo-0',
    assets: photos('coast', ['coast', 'road'], ['2026-08-08', '2026-08-09']), memories: [],
    chapters: [{ id: 'demo-sea-1', title: '海边的一个下午', body: '海浪一遍遍地走近，又一遍遍地退去。我们在岸边坐了很久，让这个下午慢慢过去。\n\n照片记录了海的颜色，文字留下了一起看海的心情。', assetIds: ['coast-photo-0', 'coast-photo-1'], layout: 'balanced', locked: false }],
    margin: 20, binding: 0, tone: '个人日记', createdAt: date, updatedAt: '2026-08-10T12:00:00.000Z', demo: true },
];
