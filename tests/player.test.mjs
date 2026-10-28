import test from "node:test";
import assert from "node:assert/strict";
import { Player } from "../src/player.js";
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(getVoices) {
  const calls = [];
  let now = 1000;
  const tts = { stop() { calls.push({ type: "stop" }); }, pause() { calls.push({ type: "pause" }); }, resume() { calls.push({ type: "resume" }); }, async speak(text, options) { calls.push({ type: "speak", text, options }); } };
  const player = new Player({ tts, getVoices: getVoices || (async () => [{ voiceName: "中文", lang: "zh-CN", remote: false }]), onChange() {}, now: () => now });
  player.load({ id: "article", lang: "zh-CN", sentences: [{ text: "第一句。" }, { text: "第二句。" }, { text: "第三句。" }] });
  return { player, calls, spoken: () => calls.filter(call => call.type === "speak"), setNow: value => { now = value; } };
}
test("end events advance once and late events from a stopped utterance are ignored", async () => {
  const { player, spoken } = setup();
  await player.play();
  const first = spoken()[0];
  first.options.onEvent({ type: "end" }); await flush();
  assert.equal(player.state.index, 1);
  first.options.onEvent({ type: "end" }); await flush();
  assert.equal(player.state.index, 1);
  player.stop();
  spoken()[1].options.onEvent({ type: "end" }); await flush();
  assert.equal(player.state.index, 1);
  assert.equal(player.state.status, "ready");
});
test("pause/resume preserves the utterance; end while paused waits for user", async () => {
  const { player, spoken } = setup();
  await player.play(); player.pause();
  spoken()[0].options.onEvent({ type: "start" });
  assert.equal(player.state.status, "paused");
  await player.play();
  assert.equal(spoken().length, 1);
  player.pause(); spoken()[0].options.onEvent({ type: "end" }); await flush();
  assert.equal(player.state.index, 1);
  assert.equal(spoken().length, 1);
  await player.play(); assert.equal(spoken().length, 2);
});
test("stop or pause during delayed voice enumeration cannot cause late speech", async () => {
  let release;
  const { player, spoken } = setup(() => new Promise(resolve => { release = resolve; }));
  const pending = player.play(); player.pause();
  release([{ voiceName: "中文", lang: "zh-CN" }]); await pending;
  assert.equal(spoken().length, 0);
  assert.equal(player.state.status, "paused");
});
test("rapid seek invalidates previous utterance and validates boundaries", async () => {
  const { player, spoken } = setup();
  await player.play();
  const old = spoken()[0];
  await player.seek(2);
  old.options.onEvent({ type: "interrupted" });
  assert.equal(player.state.index, 2);
  assert.equal(player.state.status, "playing");
  await assert.rejects(player.seek(-1), /无效/);
  await assert.rejects(player.seek(3), /无效/);
});
test("missing local voice produces an actionable error, with no speech", async () => {
  const { player, spoken } = setup(async () => [{ voiceName: "Remote", lang: "zh-CN", remote: true }]);
  await player.play();
  assert.equal(player.state.status, "error");
  assert.match(player.state.error, /未找到本地中文/);
  assert.equal(spoken().length, 0);
});
test("sleep cutoff stops playback and prevents end events from starting a new sentence", async () => {
  const { player, spoken, setNow } = setup();
  player.setSleep(5); await player.play();
  setNow(301000);
  spoken()[0].options.onEvent({ type: "end" }); await flush();
  assert.equal(player.state.status, "ready");
  assert.equal(player.state.sleepAt, 0);
  assert.equal(spoken().length, 1);
});
test("completed document restarts from its first sentence", async () => {
  const { player, spoken } = setup();
  await player.seek(2); await player.play();
  spoken()[0].options.onEvent({ type: "end" });
  assert.equal(player.state.status, "ended");
  await player.play(); assert.equal(player.state.index, 0);
});
