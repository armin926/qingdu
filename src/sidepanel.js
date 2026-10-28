import { MAX_TEXT } from "./core.js";
const $ = id => document.getElementById(id);
let data = null;
let articleId = null;
let sentencePage = 0;
let renderedPage = -1;
let activeSentence = null;
let noticeTimer = null;
let busy = false;

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").toggleAttribute("data-error", error);
  if (!error) noticeTimer = setTimeout(() => { $("notice").hidden = true; }, 4500);
}
async function send(type, payload = {}) {
  try {
    const result = await chrome.runtime.sendMessage({ type, ...payload });
    if (!result?.ok) throw new Error(result?.error || "后台暂未就绪，请重新打开清读。");
    if (result.data?.state) render(result.data);
    return result.data;
  } catch (error) { notify(error.message, true); throw error; }
}
function action(fn) { return event => { try { Promise.resolve(fn(event)).catch(error => notify(error.message, true)); } catch (error) { notify(error.message, true); } }; }
function view(name) {
  for (const key of ["reader", "library", "settings"]) $(`${key}-view`).hidden = name !== key;
  for (const button of document.querySelectorAll("[data-view]")) {
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
function render(nextData) {
  data = nextData;
  const { state, settings } = data;
  const doc = state.document;
  const count = doc?.sentences.length ?? 0;
  document.documentElement.dataset.theme = settings.theme;
  $("empty").hidden = !!doc;
  $("article").hidden = !doc;
  $("play").disabled = !count;
  const playing = ["playing", "loading"].includes(state.status);
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label", playing ? "暂停" : "播放");
  $("previous").disabled = !count || state.index === 0;
  $("next").disabled = !count || state.index >= count - 1;
  $("stop").disabled = !count;
  $("progress").disabled = !count;
  $("progress").max = Math.max(0, count - 1);
  $("progress").value = state.index;
  $("position").textContent = `${count ? state.index + 1 : 0} / ${count}`;
  $("play-status").textContent = ({ idle: "准备阅读", ready: "准备就绪", loading: "准备本地声音…", playing: "正在朗读 · 本地声音", paused: "已暂停", ended: "这篇读完了", error: "播放遇到问题" })[state.status] || "准备就绪";
  for (const key of ["rate", "volume"]) if (document.activeElement !== $(key)) $(key).value = settings[key];
  $("rate-label").value = `${settings.rate.toFixed(1)}×`;
  $("follow").checked = settings.follow;
  $("skip-code").checked = settings.skipCode;
  $("theme").value = settings.theme;
  if (document.activeElement !== $("dictionary")) $("dictionary").value = settings.dictionary.map(row => `${row.from}=${row.to}`).join("\n");
  if ([...$("voice").options].some(option => option.value === settings.voice)) $("voice").value = settings.voice;
  if (state.error) notify(state.error, true);
  if (doc) {
    if (articleId !== doc.id) {
      articleId = doc.id;
      sentencePage = Math.floor(state.index / 80);
      renderedPage = -1;
    }
    $("article-title").textContent = doc.title;
    $("source").textContent = doc.url ? new URL(doc.url).hostname : "我的阅读文本";
    const characters = doc.sentences.reduce((total, sentence) => total + sentence.text.length, 0);
    $("article-meta").textContent = `${characters.toLocaleString()} 字 · ${count} 句 · 约 ${Math.max(1, Math.ceil(characters / (350 * settings.rate)))} 分钟`;
    $("star").textContent = doc.starred ? "★" : "☆";
    $("star").setAttribute("aria-label", doc.starred ? "取消收藏当前文章" : "收藏当前文章");
    if (settings.follow && playing && Math.floor(state.index / 80) !== sentencePage) sentencePage = Math.floor(state.index / 80);
    renderSentences();
  } else { articleId = null; renderedPage = -1; activeSentence = null; }
  renderLibrary();
  renderSleep();
}
function renderSentences() {
  const { document: doc, index, status } = data.state;
  if (renderedPage !== sentencePage) {
    renderedPage = sentencePage;
    activeSentence = null;
    $("sentence-list").replaceChildren();
    doc.sentences.slice(sentencePage * 80, (sentencePage + 1) * 80).forEach((sentence, offset) => {
      const button = document.createElement("button");
      button.className = "sentence";
      button.dataset.index = sentencePage * 80 + offset;
      button.textContent = sentence.text;
      button.addEventListener("click", action(async () => {
        await send("SEEK", { index: Number(button.dataset.index) });
        if (!["playing", "loading"].includes(data.state.status)) await send("PLAY");
      }));
      $("sentence-list").append(button);
    });
  }
  if (activeSentence !== index) {
    const previous = $("sentence-list").querySelector("[aria-current]");
    previous?.removeAttribute("aria-current");
    const current = $("sentence-list").querySelector(`[data-index="${index}"]`);
    current?.setAttribute("aria-current", "true");
    if (current && data.settings.follow && status === "playing") {
      const rect = current.getBoundingClientRect();
      if (rect.top < 100 || rect.bottom > innerHeight - 250) current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    activeSentence = index;
  }
  $("page-label").textContent = `第 ${sentencePage * 80 + 1}–${Math.min((sentencePage + 1) * 80, doc.sentences.length)} 句`;
  $("page-back").disabled = sentencePage === 0;
  $("page-forward").disabled = (sentencePage + 1) * 80 >= doc.sentences.length;
}
function renderLibrary() {
  $("library-count").textContent = `${data.library.length} 篇`;
  $("library-list").replaceChildren();
  if (!data.library.length) {
    const empty = document.createElement("p"); empty.className = "small"; empty.textContent = "读过的文章会出现在这里。"; $("library-list").append(empty);
  }
  for (const doc of [...data.library].sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt)) {
    const card = document.createElement("div"); card.className = "library-card";
    const open = document.createElement("button"); open.className = "library-open"; open.textContent = `${doc.starred ? "★ " : ""}${doc.title}`;
    open.addEventListener("click", action(async () => { await send("OPEN_ARTICLE", { id: doc.id }); view("reader"); }));
    const meta = document.createElement("div"); meta.className = "library-meta";
    const label = document.createElement("span"); label.className = "small"; label.textContent = `第 ${doc.position + 1} / ${doc.count} 句`;
    const remove = document.createElement("button"); remove.className = "quiet danger"; remove.textContent = "移除"; remove.setAttribute("aria-label", `移除 ${doc.title}`);
    remove.addEventListener("click", action(() => send("DELETE_ARTICLE", { id: doc.id })));
    meta.append(label, remove);
    const bar = document.createElement("div"); bar.className = "library-progress";
    const progress = document.createElement("span"); progress.style.width = `${Math.round((doc.position + 1) / doc.count * 100)}%`; bar.append(progress);
    card.append(open, meta, bar); $("library-list").append(card);
  }
  $("clear-data").disabled = !data.library.length;
}
function renderSleep() {
  const left = Math.max(0, Math.ceil(((data?.state.sleepAt || 0) - Date.now()) / 60000));
  $("sleep-left").textContent = left ? `${left} 分钟后停止` : "";
  if (!left) $("sleep").value = "0";
  else if ($("sleep").value === "0") $("sleep").value = String([5, 15, 30, 60, 120].find(value => value >= left) || 120);
}
async function refreshVoices() {
  const voices = await send("GET_VOICES");
  $("voice").replaceChildren(new Option("自动匹配语言 · 仅本地系统语音", "auto"));
  for (const voice of voices) $("voice").add(new Option(`${voice.voiceName} · ${voice.lang || "语言未知"}`, voice.voiceName));
  $("voice-count").textContent = `${voices.length} 个本地声音${voices.some(voice => voice.lang?.startsWith("zh")) ? " · 中文可用" : " · 缺少中文声音"}`;
  if (data) $("voice").value = data.settings.voice;
  if (!$("voice").value) $("voice").value = "auto";
}

for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => view(button.dataset.view));
$("read-page").addEventListener("click", action(async () => {
  if (busy) return;
  busy = true; $("read-page").disabled = true;
  try { await send("READ_PAGE"); view("reader"); notify("正文已提取，点击播放开始朗读。"); }
  finally { busy = false; $("read-page").disabled = false; }
}));
$("import-form").addEventListener("submit", action(async event => {
  event.preventDefault();
  await send("IMPORT_TEXT", { text: $("paste-text").value, title: $("text-title").value });
  $("import-details").open = false; $("paste-text").value = ""; notify("文本已加入阅读。");
}));
$("text-file").addEventListener("change", action(async () => {
  const file = $("text-file").files[0];
  if (!file) return;
  try {
    if (file.size > MAX_TEXT * 4) throw new Error("文件过大，请分批导入。");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    await send("IMPORT_TEXT", { text, title: file.name.replace(/\.(txt|md|markdown)$/i, ""), markdown: /\.(md|markdown)$/i.test(file.name) });
    $("import-details").open = false; notify("文件已导入。");
  } catch (error) { notify(error.message.includes("encoded") ? "文件不是 UTF-8 编码，请转换后再导入。" : error.message, true); }
  finally { $("text-file").value = ""; }
}));
$("choose-file").addEventListener("click", () => $("text-file").click());
$("play").addEventListener("click", action(() => send(["playing", "loading"].includes(data.state.status) ? "PAUSE" : "PLAY")));
$("stop").addEventListener("click", action(() => send("STOP")));
$("previous").addEventListener("click", action(() => send("SEEK", { index: data.state.index - 1 })));
$("next").addEventListener("click", action(() => send("SEEK", { index: data.state.index + 1 })));
$("progress").addEventListener("change", action(() => send("SEEK", { index: Number($("progress").value) })));
$("page-back").addEventListener("click", () => { sentencePage--; renderSentences(); });
$("page-forward").addEventListener("click", () => { sentencePage++; renderSentences(); });
$("star").addEventListener("click", action(() => send("STAR", { id: data.state.document.id })));
$("refresh-voices").addEventListener("click", action(refreshVoices));
$("rate").addEventListener("input", () => { $("rate-label").value = `${Number($("rate").value).toFixed(1)}×`; });
for (const key of ["rate", "volume", "voice", "theme"]) $(key).addEventListener("change", action(() => send("SET_SETTINGS", { settings: { [key]: ["rate", "volume"].includes(key) ? Number($(key).value) : $(key).value } })));
for (const [id, key] of [["follow", "follow"], ["skip-code", "skipCode"]]) $(id).addEventListener("change", action(() => send("SET_SETTINGS", { settings: { [key]: $(id).checked } })));
$("sleep").addEventListener("change", action(() => send("SLEEP", { minutes: Number($("sleep").value) })));
$("save-dictionary").addEventListener("click", action(async () => {
  const dictionary = $("dictionary").value.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("每条词典规则需要写成「原词=读法」。");
    return { from: line.slice(0, separator), to: line.slice(separator + 1) };
  });
  await send("SET_SETTINGS", { settings: { dictionary } }); notify("发音词典已保存。");
}));
$("clear-data").addEventListener("click", action(async () => {
  if (confirm("清空所有书架文章和阅读位置？此操作无法恢复。")) { await send("CLEAR_DATA"); notify("阅读记录已清空。"); }
}));
chrome.runtime.onMessage.addListener(message => {
  if (message.type === "QINGDU_STATE") render(message.data);
  if (message.type === "QINGDU_STORAGE_ERROR") notify(message.error, true);
});
setInterval(renderSleep, 10000);
void send("GET_STATE").then(refreshVoices).catch(() => {});
