# 行迹 · 家人的旅行记忆

电脑端家庭游记应用，使用 React、TypeScript、Vite 与本地 Node.js 服务。默认 A4 竖版；项目和素材保存在当前浏览器的 IndexedDB 中。

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

服务默认只监听本机。可以通过 `TRAVEL_PORT` 修改端口。不同浏览器或不同端口各有独立的本地项目库，迁移前请导出备份。

## 已实现

- 旅行库、新建与编辑旅行、搜索、独立标注的示例游记。
- 本地批量导入照片及视频、读取照片拍摄时间和定位、照片内容去重、手动补充时间及图注、拖动排序、封面选择。
- 浏览器可解码的视频播放与关键帧选择。单个素材暂限500 MB。
- 录音、导入音频、文字回忆、关联素材、可编辑的信息提取与人工确认。
- 用户配置写作与语音模型，兼容 OpenAI Chat Completions / Audio Transcriptions 接口；支持本机模型地址。模型调用需有效密钥和对应服务权限。
- AI初稿预览、按时间建立章节、三种章节模板、正文与配图编辑、章节锁定、当前会话中的撤销与重做。
- 共用分页模型的A4预览、PDF文件下载、嵌入中文字体与可选择正文、直接打印、图片清晰度与缺失素材提示。
- 完整ZIP备份与轻量JSON备份、独立恢复项目编号、缺失素材重新关联。完整备份暂限1 GB；大量视频适合轻量备份并保留原文件。
- 百度网盘官方授权码交换、已有Token连接、目录浏览、文件选择、下载后导入。需要在百度开放平台注册有网盘权限的应用，并登记界面显示的回调地址。

## 数据与凭据

照片、视频、录音和项目保存在本机浏览器中，不自动同步到其他设备。清理浏览器站点数据会删除本地项目，请定期导出完整备份。轻量备份不包含素材文件，恢复后可以批量重新导入匹配的照片，或在素材详情中手动关联原文件。

当前备份格式的项目清单最多5 MB，单本支持最多5000个素材、300个章节和500段回忆。超过容量时会提示拆分，不会静默截去超出部分。

模型密钥、百度Client Secret和网盘Token只保留在当前打开的页面内存中，不写入浏览器持久存储或项目备份。模型配置中的服务地址和名称可以保存。调用AI时会把当前任务所选内容经本地服务发送给用户配置的提供方；图片理解需要主动开启，只发送最多6张所选照片的缩略图。

## 验证

```sh
npm run check
npm test
npm run build
```

浏览器端验收脚本需要已经安装的 Chromium 和 FFmpeg，运行前先启动应用：

```sh
CHROMIUM_PATH=/usr/bin/chromium node tests/browser.mjs
```

自动化使用模拟模型及网盘响应验证交互与错误处理；真实模型请求、百度账号权限及授权回调需使用用户自己的凭据验证。未经验证的连接不会显示“测试通过”。

## 发布状态与适用范围

当前为可独立运行的本地版本，尚未部署托管站点。本地服务不提供面向互联网的账号系统，后续托管或家庭设备同步应补上身份、数据隔离和托管存储，再发布对应版本。

HEIC/HEIF及不同视频编码能否解码取决于浏览器。无法解码的照片会进入失败清单；视频会保留原件，取得可用关键帧后才能进入打印版。当前会话的编辑撤销历史不会跨刷新保留，保存的游记正文和布局可以持续恢复。

## 素材与字体

示例图片来自 Unsplash，保存在 `public/images/`，仅供体验；示例文字为虚构。示例不是用户旅行数据。

- mountains: https://images.unsplash.com/photo-1464822759023-fed622ff2c3b
- lake: https://images.unsplash.com/photo-1470770841072-f978cf4d019e
- coast: https://images.unsplash.com/photo-1518837695005-2083093ee35b
- road: https://images.unsplash.com/photo-1473448912268-2022ce9509d8

PDF使用由Noto Sans SC生成的400字重静态TrueType字体，派生字体内部命名为Xingji Sans；字体、来源说明与OFL许可证位于 `public/fonts/`。为避免字体子集在部分PDF阅读器中的缺字问题，嵌入完整TrueType字体。来源：https://github.com/google/fonts/tree/main/ofl/notosanssc。

产品需求见 [需求草案](docs/requirements.md)。大量素材的后续架构与功能建议见 [存储方案与同类应用调研](docs/storage-and-feature-research.md)，该方案尚未实施存储迁移。
