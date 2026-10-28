(() => {
  if (globalThis.__qingduInstalled) return;
  globalThis.__qingduInstalled = true;
  let sources = new Map();
  let highlighted = null;
  const clean = text => text.replace(/[\t \u00a0]+/g, " ").replace(/\r\n?/g, "\n").replace(/ *\n */g, "\n").trim();
  const excluded = "nav,aside,footer,header,script,style,noscript,button,input,textarea,select,[hidden],[aria-hidden='true'],[role='navigation'],[contenteditable='true']";
  function visible(element) {
    if (element.closest(excluded)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }
  function extract(skipCode) {
    clearHighlight();
    sources = new Map();
    const selection = window.getSelection();
    if (selection?.toString().trim()) {
      const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      if (range) sources.set(0, { element: range.commonAncestorContainer.parentElement, range });
      return { title: document.title, url: location.href, lang: document.documentElement.lang, blocks: [{ text: clean(selection.toString()), sourceId: range ? 0 : null }], kind: "selection" };
    }
    const candidates = [...document.querySelectorAll("article,main,[role='main'],.article-content,.post-content,.entry-content")].filter(visible);
    const score = element => {
      const text = element.innerText || "";
      const links = [...element.querySelectorAll("a")].reduce((count, node) => count + (node.innerText || "").length, 0);
      return text.length - links * 1.5;
    };
    const root = candidates.sort((a, b) => score(b) - score(a))[0] || document.body;
    let nodes = [...root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,td")].filter(visible)
      .filter(node => !node.parentElement.closest("p,li,blockquote,pre,td") || !root.contains(node.parentElement.closest("p,li,blockquote,pre,td")));
    if (skipCode) nodes = nodes.filter(node => !node.closest("pre") && !node.matches("p:has(>code:only-child)"));
    if (!nodes.length) nodes = [...root.querySelectorAll("div,section")].filter(visible).filter(node => !node.querySelector("div,section,p,li"));
    const blocks = [];
    let size = 0;
    for (const node of nodes) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (visible(textNode.parentElement) && !(skipCode && textNode.parentElement.closest("code,pre"))) textNodes.push(textNode);
      }
      const text = clean(textNodes.map(item => item.textContent).join(""));
      if (!text) continue;
      size += text.length;
      if (size > 80000) throw new Error("网页超过 80,000 字，请选中部分正文后读取。");
      const sourceId = blocks.length;
      sources.set(sourceId, { element: node });
      blocks.push({ text, sourceId });
    }
    if (!blocks.length) throw new Error("没有提取到正文，请选中文字，或使用粘贴文本入口。");
    return { title: document.title, url: location.href, lang: document.documentElement.lang, blocks, kind: "page" };
  }
  function clearHighlight() {
    if (globalThis.CSS?.highlights) CSS.highlights.delete("qingdu-current");
    if (highlighted) {
      highlighted.element.style.outline = highlighted.outline;
      highlighted.element.style.outlineOffset = highlighted.offset;
      highlighted = null;
    }
  }
  function highlight(id, follow) {
    clearHighlight();
    const source = sources.get(id);
    if (!source?.element?.isConnected) return;
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      if (!document.querySelector("style[data-qingdu]")) {
        const style = document.createElement("style");
        style.dataset.qingdu = "true";
        style.textContent = "::highlight(qingdu-current){background-color:#b8eddd;color:#12362c}";
        document.documentElement.append(style);
      }
      const range = source.range || document.createRange();
      if (!source.range) range.selectNodeContents(source.element);
      CSS.highlights.set("qingdu-current", new Highlight(range));
    } else {
      highlighted = { element: source.element, outline: source.element.style.outline, offset: source.element.style.outlineOffset };
      source.element.style.outline = "2px solid #23876b";
      source.element.style.outlineOffset = "4px";
    }
    if (follow) {
      const rect = source.element.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > innerHeight) source.element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    try {
      if (message.type === "QINGDU_EXTRACT") reply({ ok: true, article: extract(message.skipCode !== false) });
      if (message.type === "QINGDU_HIGHLIGHT") { highlight(message.sourceId, message.follow); reply({ ok: true }); }
      if (message.type === "QINGDU_CLEAR") { clearHighlight(); reply({ ok: true }); }
    } catch (error) { reply({ ok: false, error: error.message }); }
  });
})();
