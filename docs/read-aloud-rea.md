# Read Aloud 发布物逆向调查

调查日期：2026-10-28。目的：为新的 Chrome / Edge 插件确定可以离线工作的语音路径，并找出可改进的网络依赖和阅读体验。以下是发布物的静态观察，不代表在中国大陆网络下完成了运行测试。

## 对象与证据

- 官方项目：<https://github.com/ken107/read-aloud>。其 README 链接的 Chrome 扩展 ID 是 `hdhinadidafjejdhmfkjgnolgimiaplp`。
- 本次发布物从 Google 的官方 CRX 更新服务下载：`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.0.0&acceptformat=crx2,crx3&x=id%3Dhdhinadidafjejdhmfkjgnolgimiaplp%26uc`。
- CRX3，manifest 版本 **2.28.1**，138 个 ZIP 成员。没有执行扩展代码，也没有验证 CRX 签名；获取来源、字节哈希和解包边界已记录。
- CRX SHA-256：`5a0ffb4df5a67face576da8340739abb3093a8d1eed96acc818edd49237ad763`。
- ZIP payload SHA-256：`54e81ac8565a8ef9b11ecc6b101927975318680a10855d5af03543709c5092da`。
- REA 解包目录身份：`15cf285b2ee28ee820312af7b5de174e4d632ed1f87f0efbac440638f6bda394`。
- GitHub 的 latest release API 返回 v1.54.1 且没有 release assets；这与实际 Chrome 商店发布物版本不同。因此没有用 GitHub 源码代替发布物。

REA 选定 16 个文件，其中 15 个 JavaScript 文件，读取 224,400 字节、访问 31,364 个 AST 节点，0 个解析失败。包括 manifest、background、defaults、tts-engines、google-translate、speech、document、player、content、content-handlers、html-doc、reader-manager、offscreen-manager、messaging、custom-voices、natural-voices。77 个可分析候选文件未被选中，其他网站适配器及依赖未作完整语义分析。

- 完整分析 Evidence：`ev_5e86de87886caa387630f93c7b5425ff3a25766ff13a24e9567b09795e1c92d3`。
- Summary Evidence：`ev_e1605dd077e68e7fa3a345be2adb69f8b76903e764a6445870dececcdec85a33`。
- tts-engines 模块身份及范围 Evidence：`ev_222a23ca31279c8a91042d18b7686650af9c44d059fac1b62d589e2281be6ef9`。
- 完整 REA 证据导出在 `rea-evidence.json`；摘要在 `rea-summary.json`；关键函数及请求节点在 `focused-rea-facts.json`。应用图和语义图均为 partial，没有截断，动态调用/属性关系仍有未知。
- 一次对 Google URL 的应用图 literal trace 返回 no-match（`ev_6d4e20c84358d1bf17ba45f4c34698185581d26e27c729e119a02e8774b1ca57`）；这仅说明该图未匹配种子，不能用于证明不存在请求。后续结论依据 REA 已解析的发布物及对同一哈希文件的逐行检查。

## 已观察到的实现

**原版并非所有朗读都必须连接 Google。** `js/defaults.js:317-345` 的自动选声顺序为：指定声音 → 每语言首选声音 → Google Natural → `remote === false` 的离线声音 → Google Network → native → GoogleTranslate → premium / 任意匹配声。`js/tts-engines.js:70-99` 使用 `chrome.tts.getVoices` / `chrome.tts.speak`，另有 Web Speech 路径映射 `remote = !localService`（100-150）。所以 Windows / macOS 的本地系统声音是可实现的基础；设备上必须实际安装并能被浏览器枚举出来。Google Natural 优先于离线声可能覆盖用户对离线的期望，但该名字本身不能证明这个引擎联网。

**选了本地声，外围初始化仍可能联网。** `js/defaults.js:153-185` 会枚举多个 provider；premium 的 `getVoices()` 在列表缺失/过期时后台请求 `https://support.readaloud.app/read-aloud/list-voices/premium`（`js/tts-engines.js:233-251`）。这项刷新不是同步等待才能得到列表，不能直接说它必然阻塞本地播放。

**语言检测可以把本地朗读的启动带到远程路径。** `js/document.js:254-270` 对不足 100 字的样本优先调用 server detection；较长文本先浏览器检测，失败再 server detection。server 路径先尝试 FastText 服务，未准备好则 POST `https://support.readaloud.app/read-aloud/detect-language`（289-310）。`js/player.js:142-153,695-702` 创建隐藏 iframe `https://ttstool.com/fasttext/index.html`；observable 用 `startWith(null)`。`ajaxPost` 的 `fetch` 没有显式 abort / timeout（`js/defaults.js:521-533`）。因此存在请求延迟拖慢开始朗读的静态可达路径；是否在用户网络重现需运行测试。所读文字可以作为检测请求的 body 发送给服务。

**GoogleTranslate 声音依赖 Google 网页的非公开 RPC。** `js/google-translate.js:4-65` 读取 `https://translate.google.com` 的 `WIZ_global_data` 参数，随后 POST `/_/TranslateWebserverUi/data/batchexecute`；96-109 使用 `jQ1olc` 返回的 base64 音频。依赖网页内部结构，存在接口变动、网络不可达导致失败的维护风险。`js/speech.js:74-80` 针对此路径把文本切到 200 字符；Google Network 路径另有约 15 秒分段和超时处理（54-78）。

**还有 Google Cloud 代理和 Read Aloud 自己的服务。** `js/tts-engines.js:667-669`：自带 GCP key 时调用官方 API；无自带 key 时调用 `https://cxl-services.appspot.com/proxy?url=https://texttospeech.googleapis.com/v1beta1/text:synthesize&token=...`。Premium 合成请求使用 `support.readaloud.app/read-aloud/speak/...`，文本置于 URL 查询参数（253-271）。国内网络可达性没有实测，不能保证上述任何 host 在所有环境可用。

**标成离线神经语音也有远程入口。** Piper、Supertonic、PocketTTS、NghiTTS 的 iframe 分别在 `piper.ttstool.com`、`supertonic.ttstool.com`、`pocket.ttstool.com`、`nghitts.ttstool.com`（`js/player.js:570-698`）；扩展通过消息请求语音服务。这证明入口页面/服务地址不在扩展包内，不证明每次合成本身上传文字。首次资源获取、模型缓存方式和真正断网使用尚未验证。

**阅读视图也有可移除的网络依赖。** `js/reader-manager.js:7-31,126-145` 通过 `fonts.gstatic.com` 获取阅读字体并缓存；默认 PDF viewer 配置位于远程 `assets.lsdsoftware.com`（`js/defaults.js:6-9`）。本次未分析 PDF 适配器，不宣称已验证 PDF 完整行为。

**正文提取和基础阅读功能已经较完整。** `js/content/html-doc.js:5-145` 排除导航/边栏/隐藏元素，按文本块阈值和长度分布提取，处理标题、列表、iframe、open shadow root。部分处理临时隐藏 DOM 内容后再恢复。`speech.js` 已有东亚分句、逐句导航、高亮状态；`defaults.js:592-638` 已有字面与正则发音替换；manifest 已有快捷键。因此高亮、分句、替换词、阅读视图不能被宣传为原版没有的独创能力。

## 对新插件的建议

1. 首版以 **默认零外部请求** 为明确优势：只枚举和使用 `chrome.tts` 的 `remote === false` 声音；语言识别用浏览器 API / Unicode 与网页语言提示；字体和 UI 完全随包提供。没有本地中文声音时明确显示安装路径和刷新按钮，不悄悄切到 Google / 云声。
2. Windows / macOS 上本地中文声音需要各自安装、枚举和试听验证。仅依赖标准 API 不等于已完成跨平台验收；不能让 Web Speech mock 替代真实离线播放。
3. 有价值的产品优化是中文侧边栏、每篇文章本地断点、阅读列表、清晰的声音状态、定时停止。所选 document/player/background 文件没有发现每文章持久书签或定时器语义，属于有边界的未发现，不能据此断言整包绝无此功能。
4. 正文提取在 clone / 本地阅读视图完成，对可见原网页的高亮应可恢复；提供“朗读选中”与粘贴文本作为通用失败出口。测试中文长文、嵌套结构、链接导航占比高的页面、动态页、隐藏内容、选中段落。
5. 发音词典首版用字面替换即可，规则长度受限、避免正则复杂性；保留原始文本和发音文本对应关系，避免替换后高亮错位。
6. 可扩展方案：本地运行的神经 TTS 或自带国内服务 key，明确作为可选高级能力。独立缓存/模型包、安全 origin 授权、服务凭据和声音自然度需要另行实测。不能把一组未验证的第三方免费接口作为“无需梯子”的承诺。

## 仍未回答的边界

已回答发布物身份、语音选择、本地 API、主要远程依赖、正文提取策略。部分回答了远程调用导致启动延迟的路径和产品差异；没有执行原版扩展，没有观察实际请求时间，没有进行大陆无代理网络探测、音质听测、Windows 实机测试、Piper 模型下载/缓存验证，或全部网站/PDF/EPUB 适配器审计。REA 是静态分析，不能把这些未知写成通过。
