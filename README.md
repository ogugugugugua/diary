# 行迹 · 家人的旅行记忆

电脑端家庭游记应用，使用 React、TypeScript、Vite 与本地 Node.js 服务。默认 A4 竖版；项目存入本地 SQLite 资料库，大量照片和视频默认引用原目录。

## 运行

需要 Node.js 22.13 或更新版本。

```sh
git clone https://github.com/ogugugugugua/diary.git
cd diary
npm ci
npm run dev
```

打开 `http://localhost:5173`。构建及运行正式版本：

```sh
npm run build
npm start
```

源码仓库不包含构建产物，首次使用请按上面的步骤安装依赖；正式运行前执行 `npm run build`。此前提供的本地运行包附带构建产物，解压后可直接运行 `node dist-server/index.js`。

服务默认只监听本机，可以通过 `TRAVEL_PORT` 修改端口。同一资料库可由本机不同浏览器使用；保存有版本检查，冲突时先下载文字备份再刷新。

资料库默认位于用户主目录下的 `行迹资料库`。可在启动前通过 `TRAVEL_DATA_DIR` 指定其他可写目录：

```sh
# macOS / Linux
TRAVEL_DATA_DIR="/path/to/行迹资料库" npm run dev
```

```powershell
# Windows PowerShell
$env:TRAVEL_DATA_DIR = "D:\行迹资料库"
npm run dev
```

移动已有资料库时先关闭服务，再迁移整个目录，并用新路径启动。

## 已实现

- 旅行库、新建与编辑旅行、搜索、独立标注的示例游记。
- 本地素材目录引用、后台建立共享索引、60项分页预览、目录搬家、旧副本完整哈希核验与重新关联。普通文件选择或拖入另提供保存副本，照片内容去重。
- SQLite 持久项目、历史版本、独立保留游记画面与录音、默认5 GiB普通缓存预算、按使用时间回收、分类容量统计与清理。
- 通过 HTTP Range 播放引用视频并选择关键帧，取消目录引用的500 MB原片上限；原图预览暂限500 MB，解码能力取决于浏览器。
- 录音、导入音频、文字回忆、关联素材、可编辑的信息提取与人工确认。
- 用户配置写作与语音模型，兼容 OpenAI Chat Completions / Audio Transcriptions 接口；支持本机模型地址。模型调用需有效密钥和对应服务权限。
- AI初稿预览、按时间建立章节、三种章节模板、正文与配图编辑、章节锁定、当前会话中的撤销与重做。
- 共用分页模型的A4预览、PDF文件下载、嵌入中文字体与可选择正文、直接打印、图片清晰度与缺失素材提示。
- 流式文件夹游记备份、可携带已采用素材原件、校验恢复与独立项目编号。继续支持文字 JSON 和旧 ZIP 恢复，新文件夹备份不受旧1 GB整包缓冲上限限制。
- 百度网盘官方授权码交换、已有Token连接、目录浏览、引用登记、原片按需下载，关闭详情后释放临时原件。需要在百度开放平台注册有网盘权限的应用，并登记界面显示的回调地址。

## 数据与凭据

正文、布局、录音、已采用的画面与索引保存在本地资料库，目录导入的原照片和视频留在原位置。清理浏览器不会删除新版项目。普通选文件/拖入会保存副本；百度原片按需准备，不长期强制复制整段视频。缓存预算不包含保留内容、导出包和正在写入的临时文件，请留出足够磁盘空间。

旧浏览器项目在“素材与存储”中迁移，原件可重新关联原目录，核验成功后再清理旧 IndexedDB。跨设备不自动同步，可通过文件夹备份恢复。游记备份只携带封面和章节采用的画面；原件备份额外携带这些素材的原件，不打包整个候选素材库。

单本支持2万个素材、300个章节和500段回忆。JSON/旧ZIP项目清单最多5 MiB；新版文件夹清单最多16 MiB、5万个文件条目。超过限制明确提示，不静默截断。详细操作、空间预期和迁移规则见 [素材管理说明](docs/material-management.md)。

模型密钥、百度Client Secret和网盘Token只保留在页面及本地服务内存中，不写入资料库、浏览器持久存储或项目备份。模型配置中的服务地址和名称可以保存。调用AI时会把当前任务所选内容经本地服务发送给用户配置的提供方；图片理解需要主动开启，只发送最多6张所选照片的缩略图。

## 验证

```sh
npm run check
npm test
npm run build
# 完整回归（需 Chromium 与 FFmpeg）
CHROMIUM_PATH=/path/to/chromium npm run verify
```

增量功能与测试覆盖见 [交付记录](docs/feature-delivery.md) 和 [测试矩阵](docs/test-matrix.md)。

浏览器端验收脚本需要已经安装的 Chromium 和 FFmpeg；请用独立的测试资料库启动应用，以免验收项目混入家庭旅行库：

```sh
# 另一个终端先运行：TRAVEL_DATA_DIR=/tmp/xingji-test-data npm run dev
CHROMIUM_PATH=/usr/bin/chromium node tests/browser.mjs
CHROMIUM_PATH=/usr/bin/chromium node tests/video-browser.mjs
CHROMIUM_PATH=/usr/bin/chromium node tests/storage-browser.mjs
```

自动化使用模拟模型及网盘响应验证交互与错误处理；真实模型请求、百度账号权限及授权回调需使用用户自己的凭据验证。未经验证的连接不会显示“测试通过”。

## 发布状态与适用范围

当前为可独立运行的本地版本，尚未部署托管站点。本地服务不提供面向互联网的账号系统，后续托管或家庭设备同步应补上身份、数据隔离和托管存储，再发布对应版本。

HEIC/HEIF及不同视频编码能否解码取决于浏览器。无法解码的复制照片会进入失败清单；目录引用仍保留索引，视频须取得可用关键帧才能进入打印版。当前会话的编辑撤销历史不会跨刷新保留，保存的游记正文和布局可以持续恢复。

## 素材与字体

示例图片来自 Unsplash，保存在 `public/images/`，仅供体验；示例文字为虚构。示例不是用户旅行数据。

- mountains: https://images.unsplash.com/photo-1464822759023-fed622ff2c3b
- lake: https://images.unsplash.com/photo-1470770841072-f978cf4d019e
- coast: https://images.unsplash.com/photo-1518837695005-2083093ee35b
- road: https://images.unsplash.com/photo-1473448912268-2022ce9509d8

PDF使用由Noto Sans SC生成的400字重静态TrueType字体，派生字体内部命名为Xingji Sans；字体、来源说明与OFL许可证位于 `public/fonts/`。为避免字体子集在部分PDF阅读器中的缺字问题，嵌入完整TrueType字体。来源：https://github.com/google/fonts/tree/main/ofl/notosanssc。

仓库中的完整字体以压缩分块资源保存于 `assets/fonts/`，安装依赖、开发、测试和构建时会自动还原到 `public/fonts/travel-sans.ttf`。还原会验证每个分块及完整字体的大小和SHA-256；无需额外下载字体。

产品需求见 [需求草案](docs/requirements.md)。大量素材的后续架构与功能建议见 [存储方案与同类应用调研](docs/storage-and-feature-research.md)，基础存储调整已实现，后续功能仍以调研建议为准。
