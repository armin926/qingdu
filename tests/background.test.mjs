import test from "node:test";
import assert from "node:assert/strict";
let listener;
let stored = {};
let alarm = null;
let onAlarm;
let injectionError = null;
const openedPanels = [];
const events = [];
globalThis.chrome = {
  runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} }, sendMessage: async () => {}, getPlatformInfo: async () => ({ os: "mac" }) },
  storage: { local: { get: async () => structuredClone(stored), set: async data => { stored = structuredClone(data); } } },
  tts: { getVoices: async () => [{ voiceName: "Native", lang: "zh-CN", remote: false }], speak: async (text, options) => events.push({ text, options }), stop() {}, pause() {}, resume() {} },
  tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ ok: true, article: { title: "网页正文", url: "https://example.com", blocks: [{ text: "第一句。第二句。" }] } }) },
  scripting: { executeScript: async () => { if (injectionError) throw new Error(injectionError); } },
  sidePanel: { setPanelBehavior: async () => {}, open: async options => { openedPanels.push(options); } },
  contextMenus: { removeAll(fn) { fn(); }, create() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  alarms: { clear: async () => { alarm = null; }, create: async (name, options) => { alarm = { name, ...options }; }, onAlarm: { addListener(fn) { onAlarm = fn; } } }
};
await import("../src/background.js");
const send = (type, extra = {}, sender = { id: "test" }) => new Promise(resolve => listener({ type, ...extra }, sender, resolve));

test("background persists imported articles, progress, settings and removes data", async () => {
  let reply = await send("IMPORT_TEXT", { title: "文章", text: "第一句。第二句。第三句。" });
  assert.equal(reply.ok, true);
  const id = reply.data.state.document.id;
  await send("SEEK", { index: 1 });
  await send("SET_SETTINGS", { settings: { rate: 1.5 } });
  assert.equal(stored.currentId, id);
  assert.equal(stored.library[0].position, 1);
  assert.equal(stored.settings.rate, 1.5);
  reply = await send("IMPORT_TEXT", { title: "同一文章", text: "第一句。第二句。第三句。" });
  assert.equal(reply.data.state.index, 1);
  assert.equal(reply.data.library.length, 1);
  await send("DELETE_ARTICLE", { id });
  reply = await send("GET_STATE");
  assert.equal(reply.data.state.document, null);
  assert.equal(reply.data.library.length, 0);
});
test("background reads current page and enforces message and text boundaries", async () => {
  const read = await send("READ_PAGE");
  assert.equal(read.data.state.document.title, "网页正文");
  assert.equal(read.data.state.document.sourceTabId, 1);
  assert.equal((await send("SEEK", { index: -1 })).ok, false);
  assert.equal((await send("IMPORT_TEXT", { text: "a".repeat(80001) })).ok, false);
  assert.equal((await send("PLAY", {}, { id: "test", tab: { id: 1 } })).ok, false);
});
test("missing host authorization is distinguished from protected browser pages", async () => {
  injectionError = "Cannot access contents of the page. Extension manifest must request permission to access the respective host.";
  let reply = await send("READ_PAGE");
  assert.equal(reply.ok, false);
  assert.match(reply.error, /尚未获得该网站的访问权限/);
  injectionError = "Cannot access a chrome:// URL";
  reply = await send("READ_PAGE");
  assert.match(reply.error, /受浏览器保护/);
  injectionError = null;
});
test("selection shortcut opens the sender's side panel and imports only selected text without autoplay", async () => {
  const reply = await send("QINGDU_READ_SELECTION", { text: "只读取这一段。", title: "选中文字", lang: "zh-CN" }, { id: "test", frameId: 0, tab: { id: 9, url: "https://example.com/selection" } });
  assert.equal(reply.ok, true);
  assert.equal(openedPanels.at(-1).tabId, 9);
  const state = (await send("GET_STATE")).data.state;
  assert.equal(state.document.sentences.map(item => item.text).join(""), "只读取这一段。");
  assert.equal(state.document.sourceTabId, 9);
  assert.equal(state.status, "ready");
  assert.equal((await send("QINGDU_READ_SELECTION", { text: "" }, { id: "test", tab: { id: 9 } })).ok, false);
  assert.equal((await send("QINGDU_READ_SELECTION", { text: "iframe" }, { id: "test", frameId: 2, tab: { id: 9 } })).ok, false);
});
test("sleep creates a persistent alarm and malformed settings cannot overwrite valid ones", async () => {
  const reply = await send("SLEEP", { minutes: 5 });
  assert.equal(reply.ok, true);
  assert.equal(alarm.name, "qingdu-sleep");
  assert.equal(alarm.when, stored.sleepAt);
  const previous = stored.settings.rate;
  assert.equal((await send("SET_SETTINGS", { settings: { rate: 100 } })).ok, false);
  assert.equal(stored.settings.rate, previous);
  await send("SLEEP", { minutes: 0 });
  assert.equal(alarm, null);
  assert.equal(typeof onAlarm, "function");
});
test("Markdown code filtering and controller playback use local voice options", async () => {
  const reply = await send("IMPORT_TEXT", { text: "你好。\n\n```js\n不该朗读的代码\n```\n\n再见。", markdown: true });
  assert.equal(reply.data.state.document.sentences.length, 2);
  await send("PLAY");
  assert.equal(events.at(-1).options.voiceName, "Native");
  assert.equal(events.at(-1).text, "你好。");
  await send("STOP");
});
