import { normalizeText, splitSentences, validateSettings, localVoices, MAX_TEXT } from "./core.js";
import { Player } from "./player.js";

let settings = validateSettings();
let library = [];
let saveQueue = Promise.resolve();
let activeTimer = null;
let previousTab = null;
let previousHighlight = "";

const player = new Player({
  tts: chrome.tts,
  getVoices: () => chrome.tts.getVoices(),
  onChange: state => {
    if (state.document) {
      state.document.position = state.index;
      const entry = library.find(item => item.id === state.document.id);
      if (entry) entry.position = state.index;
    }
    const stored = structuredClone({ settings, library, currentId: state.document?.id ?? null, sleepAt: state.sleepAt });
    saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set(stored))
      .catch(error => { chrome.runtime.sendMessage({ type: "QINGDU_STORAGE_ERROR", error: `本地保存失败：${error.message}` }).catch(() => {}); });
    chrome.runtime.sendMessage({ type: "QINGDU_STATE", data: snapshot() }).catch(() => {});
    void updateHighlight(state);
    // The timer exists only during a finite playback operation. Each call resets MV3's idle timer.
    if (["loading", "playing"].includes(state.status) && !activeTimer) {
      activeTimer = setInterval(() => { player.checkSleep(); void chrome.runtime.getPlatformInfo(); }, 20000);
    } else if (!["loading", "playing"].includes(state.status) && activeTimer) {
      clearInterval(activeTimer);
      activeTimer = null;
    }
  }
});

function snapshot() {
  return { state: structuredClone(player.state), settings, library: library.map(({ id, title, url, position, sentences, starred, updatedAt }) => ({ id, title, url, position, count: sentences.length, starred, updatedAt })) };
}

async function updateHighlight(state) {
  const tabId = state.document?.sourceTabId;
  const sourceId = state.document?.sentences[state.index]?.sourceId;
  const active = ["loading", "playing", "paused"].includes(state.status) && sourceId !== null && sourceId !== undefined;
  const signature = `${tabId}:${sourceId}:${active}:${settings.follow}`;
  if (signature === previousHighlight) return;
  previousHighlight = signature;
  if (previousTab !== null && (previousTab !== tabId || !active)) {
    await chrome.tabs.sendMessage(previousTab, { type: "QINGDU_CLEAR" }).catch(() => {});
  }
  previousTab = tabId ?? null;
  if (tabId !== null && tabId !== undefined && active) {
    await chrome.tabs.sendMessage(tabId, { type: "QINGDU_HIGHLIGHT", sourceId, follow: settings.follow }).catch(() => {});
  }
}

const ready = chrome.storage.local.get(["settings", "library", "currentId", "sleepAt"]).then(async data => {
  try { settings = validateSettings(data.settings); } catch { settings = validateSettings(); }
  player.settings = settings;
  library = Array.isArray(data.library) ? data.library.filter(doc => doc?.id && Array.isArray(doc.sentences) && doc.sentences.length).slice(0, 12) : [];
  for (const doc of library) doc.sourceTabId = null;
  const current = library.find(doc => doc.id === data.currentId);
  player.state.sleepAt = Number.isFinite(data.sleepAt) && data.sleepAt > Date.now() ? data.sleepAt : 0;
  if (player.state.sleepAt) await chrome.alarms.create("qingdu-sleep", { when: player.state.sleepAt });
  if (current) player.load(current);
});

async function loadArticle(article, sourceTabId = null) {
  if (!article || !Array.isArray(article.blocks) || article.blocks.length > 10000) throw new Error("文章数据无效。");
  const blocks = article.blocks.map(block => ({ text: normalizeText(block.text), sourceId: Number.isInteger(block.sourceId) ? block.sourceId : null })).filter(block => block.text);
  const text = blocks.map(block => block.text).join("\n\n");
  if (!text || text.length > MAX_TEXT) throw new Error(`文本为空或超过 ${MAX_TEXT.toLocaleString()} 字，请分批导入。`);
  const url = typeof article.url === "string" && /^https?:\/\//.test(article.url) ? article.url.slice(0, 4000) : "";
  const identity = new TextEncoder().encode(`${url}\n${text}`);
  const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", identity)), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
  const old = library.find(item => item.id === id);
  const document = {
    id, title: String(article.title || "未命名文本").slice(0, 160), url, lang: String(article.lang || "").slice(0, 30),
    sentences: splitSentences(blocks), position: old?.position ?? 0, starred: old?.starred ?? false,
    sourceTabId, updatedAt: Date.now()
  };
  library = [document, ...library.filter(item => item.id !== id)].slice(0, 12);
  let total = 0;
  library = library.filter(doc => { total += doc.sentences.reduce((size, item) => size + item.text.length, 0); return total <= 400000; });
  player.load(document);
  return snapshot();
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("没有找到当前网页。");
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "QINGDU_EXTRACT", skipCode: settings.skipCode });
    if (!result?.ok) throw new Error(result?.error || "无法提取正文。");
    return await loadArticle(result.article, tab.id);
  } catch (error) {
    if (/must request permission|Missing host|permission/i.test(error.message)) throw new Error("清读尚未获得该网站的访问权限。请在浏览器的扩展管理中允许访问该网站，刷新网页后重试。");
    if (/Cannot access|cannot be scripted|extensions gallery/i.test(error.message)) throw new Error("此页面受浏览器保护，不能直接读取。浏览器内部页面、扩展商店和 PDF 请使用粘贴文本。");
    throw error;
  }
}

async function handle(message) {
  switch (message.type) {
    case "GET_STATE": return snapshot();
    case "GET_VOICES": return localVoices(await chrome.tts.getVoices());
    case "READ_PAGE": return readPage();
    case "IMPORT_TEXT": {
      if (typeof message.text !== "string" || message.text.length > MAX_TEXT) throw new Error("文本为空或超过 80,000 字。");
      let text = message.text;
      if (settings.skipCode && message.markdown) text = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
      return loadArticle({ title: message.title || "粘贴文本", blocks: text.split(/\n\s*\n/).map(text => ({ text })) });
    }
    case "PLAY": await player.play(); break;
    case "PAUSE": player.pause(); break;
    case "STOP": player.stop(); break;
    case "SEEK": await player.seek(message.index); break;
    case "SET_SETTINGS": settings = validateSettings({ ...settings, ...message.settings }); await player.updateSettings(settings); break;
    case "SLEEP": {
      player.setSleep(message.minutes);
      await chrome.alarms.clear("qingdu-sleep");
      if (message.minutes) await chrome.alarms.create("qingdu-sleep", { when: player.state.sleepAt });
      break;
    }
    case "OPEN_ARTICLE": {
      const article = library.find(item => item.id === message.id);
      if (!article) throw new Error("文章已被删除。");
      player.load(article);
      break;
    }
    case "STAR": {
      const article = library.find(item => item.id === message.id);
      if (article) article.starred = !article.starred;
      player.changed();
      break;
    }
    case "DELETE_ARTICLE": {
      library = library.filter(item => item.id !== message.id);
      if (player.state.document?.id === message.id) { player.stop(); player.state.document = null; player.state.status = "idle"; }
      player.changed();
      break;
    }
    case "CLEAR_DATA": library = []; player.stop(); player.state.document = null; player.state.index = 0; player.state.status = "idle"; player.changed(); break;
    default: throw new Error("不支持的操作。");
  }
  await saveQueue;
  return snapshot();
}

let commandQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message?.type) return;
  if (message.type === "QINGDU_READ_SELECTION") {
    if (!sender.tab?.id || sender.frameId > 0 || typeof message.text !== "string" || !message.text.trim() || message.text.length > MAX_TEXT) {
      reply({ ok: false, error: "选中文字为空、超过 80,000 字或来自不支持的框架。" });
      return;
    }
    // Open before awaiting storage or the command queue, preserving the click's user gesture.
    const opened = chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => null, error => error);
    const command = commandQueue.catch(() => {}).then(() => ready).then(async () => {
      const error = await opened;
      if (error) throw error;
      await loadArticle({ title: message.title, url: sender.tab.url, lang: message.lang, blocks: [{ text: message.text, sourceId: 0 }] }, sender.tab.id);
      await saveQueue;
    });
    commandQueue = command;
    command.then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type.startsWith("QINGDU_")) return;
  if (sender.tab) { reply({ ok: false, error: "控制操作只能来自清读界面。" }); return; }
  const command = commandQueue.catch(() => {}).then(() => ready).then(() => handle(message));
  commandQueue = command;
  command.then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "qingdu-selection", title: "用清读朗读选中文字", contexts: ["selection"] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "qingdu-selection" || !tab?.id) return;
  void chrome.sidePanel.open({ tabId: tab.id });
  commandQueue = commandQueue.catch(() => {}).then(() => ready).then(async () => {
    await loadArticle({ title: tab.title || "选中文字", url: info.pageUrl, blocks: [{ text: info.selectionText }] });
    await player.play();
  }).catch(error => player.fail(error));
});
chrome.commands.onCommand.addListener(command => {
  if (command === "read-page") void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.id && chrome.sidePanel.open({ tabId: tab.id }));
  commandQueue = commandQueue.catch(() => {}).then(() => ready).then(async () => {
    if (command === "read-page") await readPage();
    if (command === "toggle-play") { if (player.state.status === "playing") player.pause(); else await player.play(); }
  }).catch(error => player.fail(error));
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "qingdu-sleep") void ready.then(() => player.checkSleep()); });
