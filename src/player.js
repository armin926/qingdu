import { applyDictionary, chooseVoice, detectLanguage, DEFAULT_SETTINGS } from "./core.js";

export class Player {
  constructor({ tts, getVoices, onChange, now = Date.now }) {
    Object.assign(this, { tts, getVoices, onChange, now });
    this.settings = { ...DEFAULT_SETTINGS };
    this.state = { document: null, index: 0, status: "idle", error: "", sleepAt: 0 };
    this.generation = 0;
    this.currentFinished = false;
  }
  changed() { return this.onChange(this.state); }
  interrupt() { this.generation++; this.tts.stop(); }
  load(document) {
    this.interrupt();
    this.state = { ...this.state, document, index: Math.min(document.position ?? 0, document.sentences.length - 1), status: "ready", error: "" };
    this.currentFinished = false;
    this.changed();
  }
  async play() {
    if (!this.state.document?.sentences.length) throw new Error("请先读取网页或导入文本。");
    if (this.state.status === "playing") return;
    if (this.state.status === "paused" && !this.currentFinished) {
      this.tts.resume();
      this.state.status = "playing";
      this.changed();
      return;
    }
    if (this.state.status === "ended") this.state.index = 0;
    await this.speak();
  }
  pause() {
    if (this.state.status === "loading") {
      this.interrupt();
      this.currentFinished = true;
      this.state.status = "paused";
      this.changed();
      return;
    }
    if (this.state.status !== "playing") return;
    this.state.status = "paused";
    this.tts.pause();
    this.changed();
  }
  stop() {
    this.interrupt();
    this.currentFinished = true;
    this.state.status = this.state.document ? "ready" : "idle";
    this.changed();
  }
  async seek(index) {
    const count = this.state.document?.sentences.length ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("句子位置无效。");
    const playing = this.state.status === "playing";
    this.interrupt();
    this.currentFinished = true;
    this.state.index = index;
    this.state.status = "ready";
    this.state.error = "";
    this.changed();
    if (playing) await this.speak();
  }
  async updateSettings(settings) {
    const restart = this.state.status === "playing";
    if (restart || this.state.status === "paused") this.stop();
    this.settings = settings;
    this.changed();
    if (restart) await this.speak();
  }
  setSleep(minutes) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) throw new Error("定时范围为 0–120 分钟。");
    this.state.sleepAt = minutes ? this.now() + minutes * 60000 : 0;
    this.changed();
  }
  checkSleep() {
    if (this.state.sleepAt && this.now() >= this.state.sleepAt) {
      this.state.sleepAt = 0;
      this.stop();
      return true;
    }
    return false;
  }
  fail(error) {
    this.interrupt();
    this.currentFinished = true;
    this.state.error = error instanceof Error ? error.message : String(error);
    this.state.status = "error";
    this.changed();
  }
  async speak() {
    if (this.checkSleep()) return;
    const generation = ++this.generation;
    this.state.status = "loading";
    this.state.error = "";
    this.currentFinished = false;
    this.changed();
    try {
      const sentence = this.state.document.sentences[this.state.index];
      const voices = await this.getVoices();
      if (generation !== this.generation) return;
      const voice = chooseVoice(voices, detectLanguage(sentence.text, this.state.document.lang), this.settings.voice);
      const text = applyDictionary(sentence.text, this.settings.dictionary) || " ";
      await this.tts.speak(text, {
        voiceName: voice.voiceName, lang: voice.lang, rate: this.settings.rate, volume: this.settings.volume,
        enqueue: false,
        onEvent: event => {
          if (generation !== this.generation) return;
          if (this.checkSleep()) return;
          if (event.type === "start") {
            // A late start must not undo a pause made immediately after pressing play.
            if (this.state.status !== "paused") this.state.status = "playing";
            this.changed();
          } else if (event.type === "end") {
            this.currentFinished = true;
            if (this.state.index + 1 >= this.state.document.sentences.length) {
              this.state.status = "ended";
              this.changed();
            } else {
              const paused = this.state.status === "paused";
              this.state.index++;
              this.changed();
              if (!paused) void this.speak();
            }
          } else if (event.type === "error") this.fail(event.errorMessage || "系统语音引擎播放失败。");
          else if (event.type === "interrupted" || event.type === "cancelled") this.stop();
        }
      });
      if (generation === this.generation && this.state.status === "loading") {
        this.state.status = "playing";
        this.changed();
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    }
  }
}
