# 验证记录 · 0.1.1

2026-10-28，宿主 macOS，真实 Chrome **156.0.8078.48**。测试使用独立浏览器配置，未读取用户的浏览器配置、登录凭据或阿里云账户数据。

## 0.1.0 漏检与根因

0.1.0 的 18 项模拟 API 测试通过，但 `chrome.scripting.executeScript` 被直接模拟成成功，没有覆盖真实浏览器权限。原生扩展的侧栏读取未验收，导致普通网页读取失败被漏检。

在独立 Chrome 中加载原始 0.1.0 ZIP，从真实侧栏发起 `READ_PAGE`，重复复现出用户截图中的完整错误。Chrome 的原始错误为：

> Cannot access contents of the page. Extension manifest must request permission to access the respective host.

实际权限的 `origins` 是空数组。只修改诊断副本的 manifest、增加 HTTP/HTTPS host permissions，同一真实侧栏流程立即成功提取正文，JavaScript 代码保持原样。由此确认网站访问权限缺失是这个问题的根因，不是网页正文不存在。

0.1.1 补齐网站权限和自动内容脚本；分别提示未授权网站与浏览器保护页面，避免混为同一个错误。

## 0.1.1 已通过

- `npm test`：20 项测试通过。覆盖原有 18 项逻辑，以及权限错误分类、选中文字消息来源、侧栏打开、只导入选中段落和等待用户播放。
- `npm run check`：Manifest V3、包内文件、JavaScript 语法、HTTP/HTTPS 内容脚本与权限一致、`connect-src 'none'`，运行源码没有网络请求。
- **真实内容脚本**：未先打开扩展，选中普通网页中的段落后清读按钮自动出现；真实鼠标点击后打开原生侧栏，只导入选中的两个句子，并保持 ready 状态。
- **真实侧栏 UI**：用 Chrome DevTools Protocol 的鼠标事件点击侧栏「读取当前页」，提取完整正文，过滤导航、隐藏文字、广告与代码。
- **跨网站场景**：侧栏保持打开，把当前页从 `127.0.0.1` 导航到 `localhost`，成功读取包含标题、说明和空数据表格的控制台布局页面。两个域名是不同 origin，覆盖临时授权失效的场景。
- **真实本地存储**：跳到第 2 句后，实际 `chrome.storage.local` 中的当前文章 position 为 1。
- **真实本地 TTS**：枚举到 180 个系统本地声音，选择「婷婷」，将浏览器网络设为 offline 后使用原生 `chrome.tts` 朗读两句中文并收到完成事件，状态变为 ended。实测详情保存在 `native-qa.json`。

这些检查使用项目原有 background、player、core、content 和 sidepanel 文件，没有替换 Chrome API 或语音接口。测试网页是本地可复现样本，不是用户登录的阿里云控制台。

## 原生回归脚本

`tests/native-ui.js` 是 Playwright CLI 的 run-code 脚本，连接真实原生侧栏目标并操作真实扩展 API。`tests/native-fixture-server.mjs` 提供文章与控制台布局样本。

先启动样本服务器：

```sh
node tests/native-fixture-server.mjs
```

使用独立的 Chrome 配置启动 Playwright CLI：launchOptions 中设 `ignoreDefaultArgs: ["--disable-extensions"]` 与 `args: ["--enable-unsafe-extension-debugging"]`，使用 `--persistent`，然后通过 browser CDP 的 `Extensions.loadUnpacked` 加载本项目绝对路径。此测试标志只用于独立测试浏览器，不用于用户的日常浏览器。

```sh
npx --yes --package @playwright/cli playwright-cli -s=qingdu-native run-code --filename=tests/native-ui.js
npx --yes --package @playwright/cli playwright-cli -s=qingdu-native eval '() => globalThis.__qingduNativeQA' --raw
```

`passed: true` 才表示全部原生检查通过。不要只看 CLI 的退出码：该版本 CLI 可能把脚本错误输出为 `### Error`，但返回 0。运行时安装包不含这些测试工具。

## 仍未验收

Windows Chrome/Edge 实机、30 分钟后台播放、系统睡眠/唤醒、大量真实网站、复杂 iframe、封闭 Shadow DOM、PDF/EPUB/OCR；用户登录状态下的阿里云控制台也未直接访问。原生短文离线检查不等于完整的大陆无代理安装与使用路径录制。

插件商店发布继续停止，没有付款或提交审核。
