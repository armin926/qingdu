async (page) => {
  const report = { browser: await page.context().browser().version(), checks: [] };
  const context = page.context();
  let session;
  let sessionId;
  let next = 1;
  const pending = new Map();
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = next++;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      session.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function request(type, extra = {}) {
    const reply = await evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ type, ...extra })})`);
    assert(reply?.ok, `${type}: ${reply?.error}`);
    return reply.data;
  }
  try {
    await page.goto("http://127.0.0.1:43120/article");
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("selected"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const button = page.locator("[data-qingdu-selection]").locator("button");
    await button.waitFor({ state: "visible" });
    report.checks.push("selection button appears without opening the extension first");
    await button.click();
    await button.waitFor({ state: "hidden" });
    session = await context.browser().newBrowserCDPSession();
    const target = (await session.send("Target.getTargets")).targetInfos.find(target => target.type === "page" && target.url.startsWith("chrome-extension://") && target.url.endsWith("/src/sidepanel.html"));
    assert(target, "Clicking the selection button did not open a native side panel");
    ({ sessionId } = await session.send("Target.attachToTarget", { targetId: target.targetId, flatten: false }));
    session.on("Target.receivedMessageFromTarget", event => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timeout);
      pending.delete(message.id);
      message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
    });
    let data = await request("GET_STATE");
    assert(data.state.document.sentences.map(item => item.text).join("") === "午后的阳光落在书页上。我们把阅读的时间留给自己。", "Selected text was lost or extra page text was imported");
    assert(data.state.status === "ready", "Selection import should wait for the user's play action");
    report.checks.push("trusted click opens native side panel and imports exactly the selection without autoplay");
    await page.evaluate(() => getSelection().removeAllRanges());
    const rect = await evaluate('(()=>{const r=document.getElementById("read-page").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
    await evaluate('new Promise((resolve,reject)=>{const limit=Date.now()+4000;const timer=setInterval(()=>{if(document.getElementById("position").textContent==="1 / 4"){clearInterval(timer);resolve(true);}else if(Date.now()>limit){clearInterval(timer);reject(new Error("Sidebar read-page click did not load the full article"));}},50);})');
    data = await request("GET_STATE");
    const text = data.state.document.sentences.map(item => item.text).join("");
    assert(text.includes("春日阅读") && text.includes("本地系统语音"), "Full article missing visible text");
    assert(!/导航噪声|广告噪声|隐藏文字|代码不应/.test(text), "Extraction included navigation, hidden text or code");
    report.checks.push("real side-panel read-page click succeeds and filters navigation, hidden content and code");
    await page.goto("http://localhost:43120/console");
    data = await request("READ_PAGE");
    assert(data.state.document.title === "控制台布局测试" && data.state.document.sentences.some(item => item.text === "暂无数据"), "Cross-origin console-layout extraction failed");
    report.checks.push("reading another origin with a console/table layout succeeds while the side panel stays open");
    await request("SEEK", { index: 1 });
    const worker = context.serviceWorkers().find(worker => worker.url().includes("/src/background.js"));
    const saved = await worker.evaluate(() => chrome.storage.local.get(["library", "currentId"]));
    assert(saved.library.find(item => item.id === saved.currentId).position === 1, "Native storage failed to save progress");
    report.checks.push("native chrome.storage.local saves the selected sentence position");
    const voices = await request("GET_VOICES");
    report.localVoiceCount = voices.length;
    const chinese = voices.find(voice => voice.lang?.startsWith("zh") && /tingting|婷婷/i.test(voice.voiceName)) || voices.find(voice => voice.lang?.startsWith("zh"));
    if (chinese) {
      await request("IMPORT_TEXT", { text: "你好。这是清读离线测试。", title: "本地语音验证" });
      await request("SET_SETTINGS", { settings: { voice: chinese.voiceName } });
      await request("SEEK", { index: 0 });
      await context.setOffline(true);
      const started = Date.now();
      await request("PLAY");
      await evaluate('new Promise((resolve,reject)=>{const limit=Date.now()+20000;const timer=setInterval(()=>{const status=document.getElementById("play-status").textContent;if(status==="这篇读完了"){clearInterval(timer);resolve(true);}else if(status==="播放遇到问题"||Date.now()>limit){clearInterval(timer);reject(new Error("Native local TTS failed: "+document.getElementById("notice").textContent));}},50);})');
      report.nativeTts = { voice: chinese.voiceName, offline: true, durationMs: Date.now() - started, status: (await request("GET_STATE")).state.status };
      report.checks.push("native chrome.tts reads a short Chinese text with browser networking offline and sends completion events");
      await request("STOP");
      await context.setOffline(false);
    } else report.nativeTts = { skipped: "No local Chinese voice installed" };
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    throw error;
  } finally {
    await context.setOffline(false);
    await page.evaluate(result => { globalThis.__qingduNativeQA = result; }, report);
    if (sessionId) await session.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    if (session) await session.detach();
  }
}
