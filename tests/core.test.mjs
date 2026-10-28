import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText, detectLanguage, splitSentences, validateSettings, applyDictionary, localVoices, chooseVoice, MAX_TEXT } from "../src/core.js";

test("normalization preserves paragraphs and removes unsafe controls", () => {
  assert.equal(normalizeText("  清\t读\r\n\r\n\r\n你好\u0000  "), "清 读\n\n你好");
});
test("language detection stays local and detects Chinese, Japanese, Korean and hints", () => {
  assert.equal(detectLanguage("你好世界。"), "zh-CN");
  assert.equal(detectLanguage("今日は良い日です。"), "ja-JP");
  assert.equal(detectLanguage("안녕하세요"), "ko-KR");
  assert.equal(detectLanguage("Bonjour le monde", "fr-FR"), "fr-FR");
  assert.equal(detectLanguage("Hello!"), "en-US");
});
test("segmentation handles punctuation, Unicode and original block offsets", () => {
  const blocks = [{ text: "第一句。第二句！", sourceId: 5 }, { text: "😀".repeat(401) }];
  const result = splitSentences(blocks);
  assert.equal(result[0].text, "第一句。");
  assert.equal(result[1].start, 4);
  assert.equal(result[1].sourceId, 5);
  assert.ok(result.every(sentence => Array.from(sentence.text).length <= 160));
  assert.ok(result.every(sentence => !/[\ud800-\udbff]$/u.test(sentence.text)));
  assert.equal(result.slice(2).map(sentence => sentence.text).join(""), blocks[1].text);
});
test("unbroken English and huge text remain bounded", () => {
  assert.equal(splitSentences([{ text: "a".repeat(321) }]).length, 3);
  assert.throws(() => splitSentences([{ text: "a".repeat(MAX_TEXT + 1) }]), /超过/);
});
test("dictionary replacements are literal, longest-first and never cascade", () => {
  const rows = [{ from: "API", to: "接口" }, { from: "接口", to: "另一个词" }, { from: "C++", to: "C加加" }, { from: "A", to: "诶" }, { from: "$&", to: "$1" }];
  assert.equal(applyDictionary("API C++ 接口 $&", rows), "接口 C加加 另一个词 $1");
  assert.equal(applyDictionary("API", [{ from: "API", to: "" }]), "");
});
test("voice selection cannot silently switch to remote or extension voices", () => {
  const voices = [{ voiceName: "Cloud", lang: "zh-CN", remote: true }, { voiceName: "Third-party", lang: "zh-CN", remote: false, extensionId: "x" }, { voiceName: "Native", lang: "zh-CN" }, { voiceName: "English", lang: "en-US", remote: false }];
  assert.deepEqual(localVoices(voices).map(voice => voice.voiceName), ["English", "Native"]);
  assert.equal(chooseVoice(voices, "zh-CN").voiceName, "Native");
  assert.throws(() => chooseVoice(voices, "zh-CN", "Cloud"), /不可用/);
  assert.throws(() => chooseVoice(voices.slice(0, 2), "zh-CN"), /未找到本地中文/);
  assert.throws(() => chooseVoice(voices, "de-DE"), /没有/);
});
test("settings reject malformed rules and out-of-range controls", () => {
  assert.throws(() => validateSettings({ rate: Infinity }), /超出/);
  assert.throws(() => validateSettings({ volume: -1 }), /超出/);
  assert.throws(() => validateSettings({ dictionary: [{ from: "", to: "a" }] }), /词典/);
  assert.throws(() => validateSettings({ dictionary: "bad" }), /格式/);
  assert.equal(validateSettings({ theme: "unknown" }).theme, "system");
});
