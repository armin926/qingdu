export const MAX_TEXT = 80000;
export const DEFAULT_SETTINGS = {
  rate: 1, volume: 1, voice: "auto", skipCode: true,
  follow: true, dictionary: [], theme: "system"
};

export function normalizeText(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[\t \u00a0]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function detectLanguage(text, hint = "") {
  const sample = text.slice(0, 2000);
  const han = (sample.match(/\p{Script=Han}/gu) || []).length;
  const latin = (sample.match(/[a-z]/gi) || []).length;
  if (/[\u3040-\u30ff]/u.test(sample)) return "ja-JP";
  if (/[\uac00-\ud7af]/u.test(sample)) return "ko-KR";
  if (han > 0 && han * 3 >= latin) return "zh-CN";
  return /^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(hint) ? hint : "en-US";
}

export function splitSentences(blocks, maxLength = 160) {
  const result = [];
  let consumed = 0;
  for (const block of blocks) {
    const text = normalizeText(block.text);
    const segmenter = new Intl.Segmenter(detectLanguage(text), { granularity: "sentence" });
    for (const segment of segmenter.segment(text)) {
      let remaining = segment.segment.trim();
      let offset = segment.index + segment.segment.indexOf(remaining);
      while (remaining) {
        const characters = Array.from(remaining);
        let part = characters.slice(0, maxLength).join("");
        if (characters.length > maxLength) {
          const boundary = Math.max(part.lastIndexOf("，"), part.lastIndexOf(","), part.lastIndexOf(" "), part.lastIndexOf("；"));
          if (boundary > part.length / 2) part = part.slice(0, boundary + 1);
        }
        const content = part.trim();
        if (content) result.push({ text: content, sourceId: block.sourceId ?? null, start: offset + part.indexOf(content), end: offset + part.indexOf(content) + content.length });
        remaining = remaining.slice(part.length);
        offset += part.length;
        const spaces = remaining.length - remaining.trimStart().length;
        offset += spaces;
        remaining = remaining.trimStart();
      }
    }
    consumed += text.length;
    if (consumed > MAX_TEXT) throw new Error(`文本超过 ${MAX_TEXT.toLocaleString()} 字，请分批导入。`);
  }
  return result;
}

export function validateSettings(input = {}) {
  const output = { ...DEFAULT_SETTINGS };
  for (const key of ["rate", "volume"]) {
    const value = Number(input[key] ?? output[key]);
    const [min, max] = key === "rate" ? [0.5, 3] : [0, 1];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error("语速或音量超出范围。");
    output[key] = value;
  }
  output.voice = typeof input.voice === "string" ? input.voice.slice(0, 200) : "auto";
  for (const key of ["skipCode", "follow"]) output[key] = typeof input[key] === "boolean" ? input[key] : output[key];
  output.theme = ["system", "light", "dark"].includes(input.theme) ? input.theme : "system";
  if (input.dictionary !== undefined && !Array.isArray(input.dictionary)) throw new Error("发音词典格式错误。");
  output.dictionary = (input.dictionary ?? []).map(row => {
    if (!row || typeof row.from !== "string" || typeof row.to !== "string" || !row.from.trim() || row.from.length > 80 || row.to.length > 160) throw new Error("词典每条需要原词和读法，原词最多 80 字，读法最多 160 字。");
    return { from: row.from.trim(), to: row.to.trim() };
  });
  if (output.dictionary.length > 100) throw new Error("发音词典最多 100 条。");
  return output;
}

export function applyDictionary(text, dictionary) {
  if (!dictionary.length) return text;
  const rows = [...dictionary].sort((a, b) => b.from.length - a.from.length);
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(rows.map(row => escape(row.from)).join("|"), "gu");
  return text.replace(pattern, word => rows.find(row => row.from === word).to);
}

export function localVoices(voices) {
  // Native OS voices sometimes omit remote. Third-party engines are excluded even if they claim to be local.
  return voices.filter(voice => voice.voiceName && voice.remote !== true && !voice.extensionId)
    .sort((a, b) => `${a.lang}${a.voiceName}`.localeCompare(`${b.lang}${b.voiceName}`));
}

export function chooseVoice(voices, lang, preferred = "auto") {
  const local = localVoices(voices);
  if (preferred !== "auto") {
    const selected = local.find(voice => voice.voiceName === preferred);
    if (!selected) throw new Error("所选本地声音不可用，请刷新声音列表或选择自动。");
    return selected;
  }
  const base = lang.toLowerCase().split("-")[0];
  const voice = local.find(item => item.lang?.toLowerCase() === lang.toLowerCase())
    ?? local.find(item => item.lang?.toLowerCase().split("-")[0] === base);
  if (!voice) throw new Error(base === "zh" ? "未找到本地中文声音。请在设置中的语音安装指引安装后，刷新声音列表。" : `没有 ${lang} 的本地声音，请安装相应系统语音或手动选择声音。`);
  return voice;
}
