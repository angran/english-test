/* =========================================================================
   英语能力测试 · 应用逻辑
   - 输入词汇量 → 定档 → 按种子确定性出卷（同一编号 = 同一份卷）
   - 阅读/听力：选择题，自动判分
   - 写作：限时作答，实时字数
   - 口语：上传音频（也可浏览器直接录音）
   - 结果：客观题自动评分 + 主观题打包导出 zip（含录音）
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------- 小工具 ---- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const APP = $('#app');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pickSeeded(arr, n, rnd) {
  const pool = arr.slice(), out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
/* 按种子打乱选项顺序并重新定位正确答案：
   题库作者难免把正确项写在固定位置，打乱后才不会被「一路蒙 B」蒙到分 */
function shuffleOptions(q, rnd) {
  const idx = q.options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return { q: q.q, options: idx.map(i => q.options[i]), answer: idx.indexOf(q.answer) };
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function words(t) { return (t || '').trim().split(/\s+/).filter(Boolean).length; }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ------------------------------------------------------ 邮件通道 ---- */
/* 三种运行环境：
   gas  —— 页面由 Google Apps Script 托管，用内部通道调用，有成功/失败回执
   http —— 页面在别的静态空间，跨域 POST 到 /exec，只能发出去、拿不到回执
   none —— 没配置，考试照常进行，结果页给出提醒和补发按钮 */
const MAIL = {
  mode() {
    if (typeof google !== 'undefined' && google.script && google.script.run) return 'gas';
    if (window.EET_CONFIG && EET_CONFIG.WEBHOOK_URL) return 'webhook';
    if (window.EET_CONFIG && EET_CONFIG.ENDPOINT_URL) return 'http';
    return 'none';
  },
  modeText() {
    return {
      gas: '已连通（Apps Script 内部通道）',
      webhook: '群机器人（' + (this.bot() === 'feishu' ? '飞书' : '企业微信') + '）',
      http: '已配置（跨域发送，无法确认送达）',
      none: '未配置'
    }[this.mode()];
  },
  bot() {
    const u = (window.EET_CONFIG && EET_CONFIG.WEBHOOK_URL) || '';
    return /feishu|larksuite/i.test(u) ? 'feishu' : 'wecom';
  },
  /* 不让考生卡在「正在通知考官」上：超时就当失败，转入本地队列稍后补发 */
  sendTimeout(payload, ms) {
    return Promise.race([
      this.send(payload),
      new Promise(res => setTimeout(() => res({ ok: false, mode: this.mode(), detail: '发送超时' }), ms || 15000))
    ]);
  },
  /* ---- 群机器人：把结构化载荷排成人能读的消息 ---- */
  /* 各家上限不同，超了对方直接拒收，所以按机器人类型分别留余量：
     企业微信 text 上限 2048 字节，飞书宽松得多。
     一律用 text 类型而不是 markdown——考生作文里可能有 * # 之类的符号，
     markdown 会把它们当格式渲染，改变原文观感。 */
  chunkBytes() { return this.bot() === 'feishu' ? 3500 : 1900; },
  bytes(s) { return new Blob([s]).size; },

  splitMessage(text) {
    const LIMIT = this.chunkBytes();
    if (this.bytes(text) <= LIMIT) return [text];
    const lines = text.split('\n'), out = [];
    let buf = '';
    for (const ln of lines) {
      if (buf && this.bytes(buf + '\n' + ln) > LIMIT) { out.push(buf); buf = ln; }
      else buf = buf ? buf + '\n' + ln : ln;
      /* 单行本身就超长（一整段写作往往没有换行），按字符硬切。
         中英混排时字节数和字符数不成比例，所以按比例估算后再逐步收缩。 */
      while (this.bytes(buf) > LIMIT) {
        let cut = Math.max(1, Math.floor(buf.length * LIMIT / this.bytes(buf)));
        while (cut > 1 && this.bytes(buf.slice(0, cut)) > LIMIT) cut--;
        out.push(buf.slice(0, cut)); buf = buf.slice(cut);
      }
    }
    if (buf) out.push(buf);
    return out.map((t, i) => '（' + (i + 1) + '/' + out.length + '）\n' + t);
  },

  compose(d) {
    const kw = (window.EET_CONFIG && EET_CONFIG.WEBHOOK_KEYWORD) || '英语测试';
    if (d.kind === 'start') {
      return ['【' + kw + '】开考',
        '考生：' + d.name,
        '开始时间：' + d.startedAt + (d.tz ? '（' + d.tz + '）' : ''),
        '词汇量 ' + d.vocab + ' → ' + d.band + ' 卷（微调档 ' + d.neighbor + '）',
        '试卷编号：' + d.code,
        '构成：' + d.paper].join('\n');
    }
    if (d.kind === 'finish') {
      const head = ['【' + kw + '】交卷',
        '考生：' + d.name + '　编号 ' + d.code,
        '用时 ' + (d.duration || '—') + '（' + d.startedAt + ' → ' + d.finishedAt + '）',
        '阅读 ' + d.reading.correct + '/' + d.reading.total +
        '　听力 ' + d.listening.correct + '/' + d.listening.total +
        '　正确率 ' + d.percent + '%',
        '推算水平：' + d.estLevel + '（约 ' + d.estVocab + ' 词）',
        d.note || ''].join('\n');
      const writing = (d.writing || []).map(w =>
        '\n—— 写作 Task ' + w.task + '（' + w.words + ' 词 / 要求 ' + w.required + '）——\n' + w.text).join('\n');
      const spk = (d.speaking || []);
      const done = spk.filter(s => s.file).length;
      const tail = '\n—— 口语 ——\n' + (done
        ? done + ' 题已录音。群机器人发不了音频，请考生把结果包（zip）发给考官。'
        : '未提交音频。');
      return head + '\n' + writing + tail;
    }
    return '【' + kw + '】' + JSON.stringify(d).slice(0, 500);
  },

  async postWebhook(payload) {
    const url = EET_CONFIG.WEBHOOK_URL;
    const parts = this.splitMessage(this.compose(payload));
    const isFeishu = this.bot() === 'feishu';
    try {
      for (const text of parts) {
        const body = isFeishu
          ? { msg_type: 'text', content: { text: text } }
          : { msgtype: 'text', text: { content: text } };
        /* 必须用 text/plain：application/json 会触发 CORS 预检，
           而这两个 webhook 都不返回 CORS 头，预检必然失败、请求根本发不出去。
           它们的服务端不校验 Content-Type，照样能解析 JSON 体。 */
        await fetch(url, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body)
        });
      }
      return { ok: true, mode: 'webhook', detail: '已推送 ' + parts.length + ' 条' };
    } catch (e) {
      return { ok: false, mode: 'webhook', detail: e.message };
    }
  },

  send(payload) {
    const mode = this.mode();
    if (mode === 'webhook') return this.postWebhook(payload);
    if (mode === 'gas') {
      return new Promise(res => {
        google.script.run
          .withSuccessHandler(r => res({ ok: !!(r && r.ok), mode, detail: (r && (r.message || r.error)) || '' }))
          .withFailureHandler(e => res({ ok: false, mode, detail: String((e && e.message) || e) }))
          .relay(payload);
      });
    }
    if (mode === 'http') {
      /* text/plain + no-cors = 简单请求，不触发预检；Apps Script 不返回 CORS 头，
         所以只能「发出即认为成功」，真正的确认靠考官收件箱 */
      return fetch(EET_CONFIG.ENDPOINT_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(() => ({ ok: true, mode, detail: '已发出' }))
        .catch(e => ({ ok: false, mode, detail: e.message }));
    }
    return Promise.resolve({ ok: false, mode: 'none', detail: '未配置邮件服务' });
  },
  /* 发送失败的通知先攒在本地，结果页可以一键补发（录音太大，不进队列） */
  queue(payload) {
    try {
      const q = JSON.parse(localStorage.getItem('eet:mailq') || '[]');
      q.push(payload);
      localStorage.setItem('eet:mailq', JSON.stringify(q.slice(-20)));
    } catch (e) { }
  },
  async flush() {
    let q = [];
    try { q = JSON.parse(localStorage.getItem('eet:mailq') || '[]'); } catch (e) { }
    if (!q.length) return { sent: 0, left: 0 };
    const left = [];
    for (const p of q) { const r = await this.send(p); if (!r.ok) left.push(p); }
    try { localStorage.setItem('eet:mailq', JSON.stringify(left)); } catch (e) { }
    return { sent: q.length - left.length, left: left.length };
  }
};

/* ---------------------------------------------------------- 状态 ---- */
const S = {
  cfg: null,        // { name, vocab, seed, code, playLimit, practice, enforce, writingCount, speakingCount, voiceURI }
  exam: null,
  ans: null,        // { reading:{}, listening:{}, writing:[], speaking:[] }
  screen: 'setup',
  timerId: null,
  submitted: false,
  result: null,
  startedAt: null,      // 考生真正开始答第一部分的时刻
  finishedAt: null,
  mail: { start: null, finish: null }   // 两封通知各自的发送结果
};

/* 考生链接参数：Apps Script 托管时页面在 iframe 里，取不到 /exec 的查询串，
   由服务端注入 EET_URL_PARAMS；其他托管方式直接读地址栏 */
function urlParams() {
  if (window.EET_URL_PARAMS) return window.EET_URL_PARAMS;
  const p = {};
  new URLSearchParams(location.search).forEach((v, k) => p[k] = v);
  return p;
}
function baseUrl() {
  return window.EET_BASE_URL || (location.origin + location.pathname);
}
function nowStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

const SECTION_ORDER = ['reading', 'listening', 'writing', 'speaking', 'submit'];
const READ_MINUTES = { a2: 20, b1: 25, b2: 30, c1: 35, c2: 40 };
const LISTEN_MINUTES = { a2: 12, b1: 14, b2: 16, c1: 18, c2: 20 };

/* ---------------------------------------------------------- 出卷 ---- */
function bandFor(vocab) {
  const bs = EXAM_BANK.bands;
  for (const b of bs) if (vocab >= b.min && vocab <= b.max) return b;
  return vocab < bs[0].min ? bs[0] : bs[bs.length - 1];
}
function neighborFor(band, vocab) {
  const bs = EXAM_BANK.bands, i = bs.indexOf(band);
  const span = Math.max(1, band.max - band.min);
  const pos = Math.min(1, Math.max(0, (vocab - band.min) / span));
  if (pos >= 0.5 && i < bs.length - 1) return bs[i + 1];
  if (pos < 0.5 && i > 0) return bs[i - 1];
  return band;
}

function buildExam(cfg) {
  const rnd = mulberry32(cfg.seed);
  const band = bandFor(cfg.vocab);
  const nb = neighborFor(band, cfg.vocab);
  const sameNb = nb.id === band.id;

  /* --- 阅读：主档 1 篇 + 相邻档 1 篇 --- */
  const r1 = pickSeeded(band.reading, 1, rnd)[0];
  const r2 = sameNb
    ? pickSeeded(band.reading.filter(p => p !== r1), 1, rnd)[0]
    : pickSeeded(nb.reading, 1, rnd)[0];
  const readingItems = [
    { src: band.cefr, title: r1.title, text: r1.text, qs: r1.questions },
    { src: nb.cefr, title: r2.title, text: r2.text, qs: r2.questions }
  ];

  /* --- 听力：主档 3 段 + 相邻档 1 段 --- */
  const l1 = pickSeeded(band.listening, sameNb ? 4 : 3, rnd);
  const l2 = sameNb ? [] : pickSeeded(nb.listening, 1, rnd);
  const listeningItems = l1.map(x => ({ src: band.cefr, title: x.title, lines: x.lines, qs: x.questions }))
    .concat(l2.map(x => ({ src: nb.cefr, title: x.title, lines: x.lines, qs: x.questions })));

  /* --- 写作：主档，尽量一短一长 --- */
  const shorts = band.writing.filter(w => w.type === 'short');
  const essays = band.writing.filter(w => w.type === 'essay');
  let wTasks = [];
  if (cfg.writingCount >= 2) {
    wTasks = [pickSeeded(shorts, 1, rnd)[0], pickSeeded(essays, 1, rnd)[0]].filter(Boolean);
    while (wTasks.length < cfg.writingCount) {
      const rest = band.writing.filter(w => wTasks.indexOf(w) < 0);
      if (!rest.length) break;
      wTasks.push(pickSeeded(rest, 1, rnd)[0]);
    }
  } else {
    wTasks = pickSeeded(essays.length ? essays : band.writing, 1, rnd);
  }

  /* --- 口语：主档 --- */
  const sTasks = pickSeeded(band.speaking, Math.min(cfg.speakingCount, band.speaking.length), rnd);

  /* --- 编号 & 展开题号 --- */
  let n = 0;
  readingItems.forEach(it => {
    it.qs = it.qs.map(q => { const s = shuffleOptions(q, rnd); s.id = 'R' + (++n); return s; });
  });
  n = 0;
  listeningItems.forEach(it => {
    it.qs = it.qs.map(q => { const s = shuffleOptions(q, rnd); s.id = 'L' + (++n); return s; });
  });

  return {
    code: cfg.code,
    name: cfg.name,
    vocab: cfg.vocab,
    seed: cfg.seed,
    date: todayStr(),
    band: band, neighbor: nb,
    reading: { minutes: READ_MINUTES[band.id] || 30, items: readingItems },
    listening: { minutes: LISTEN_MINUTES[band.id] || 15, items: listeningItems, rate: band.rate },
    writing: { tasks: wTasks, minutes: wTasks.reduce((a, t) => a + t.minutes, 0) },
    speaking: { tasks: sTasks }
  };
}

function totalQs(sec) { return sec.items.reduce((a, i) => a + i.qs.length, 0); }

/* ---------------------------------------------------------- 存档 ---- */
function saveKey() { return 'eet:' + (S.cfg ? S.cfg.code : 'tmp'); }
function persist() {
  if (!S.cfg) return;
  try {
    const spk = (S.ans.speaking || []).map(x => x ? { name: x.name, type: x.type, size: x.size, source: x.source } : null);
    localStorage.setItem(saveKey(), JSON.stringify({
      cfg: S.cfg, screen: S.screen, submitted: S.submitted,
      startedAt: S.startedAt, finishedAt: S.finishedAt, mail: S.mail,
      ans: { reading: S.ans.reading, listening: S.ans.listening, writing: S.ans.writing, speaking: spk },
      plays: S.plays || {}
    }));
    localStorage.setItem('eet:last', S.cfg.code);
  } catch (e) { /* 存储满或隐私模式，忽略 */ }
}
function loadSaved(code) {
  try { const raw = localStorage.getItem('eet:' + code); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

/* ---------------------------------------------------------- 语音 ---- */
const TTS = {
  ready: false, voices: [], voice: null, chain: [], idx: 0, playing: false,
  keepAlive: null, onEnd: null, onProgress: null,

  init(cb) {
    if (!('speechSynthesis' in window)) { this.ready = true; cb && cb(); return; }
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
      this.ready = true;
      if (!this.voice && this.voices.length) this.voice = this.pickDefault();
      cb && cb();
    };
    load();
    speechSynthesis.onvoiceschanged = load;
    setTimeout(load, 400);
  },
  pickDefault() {
    const pref = [/en-GB/i, /en-US/i, /en/i];
    for (const p of pref) { const v = this.voices.find(v => p.test(v.lang)); if (v) return v; }
    return this.voices[0] || null;
  },
  setVoice(uri) { this.voice = this.voices.find(v => v.voiceURI === uri) || this.voice; },

  /* 把一段台词切成句子块，规避 Chrome 长句被截断的老问题 */
  chunks(text) {
    const parts = String(text).match(/[^.!?]+[.!?]*\s*/g) || [text];
    const out = []; let buf = '';
    parts.forEach(p => {
      if ((buf + p).length > 170 && buf) { out.push(buf.trim()); buf = p; }
      else buf += p;
    });
    if (buf.trim()) out.push(buf.trim());
    return out;
  },

  speak(lines, rate, handlers) {
    this.stop();
    /* 没有英文语音就直接报错：用中文语音去念英文毫无意义，
       而且部分环境下 speak() 会挂住不返回 */
    if (!('speechSynthesis' in window) || !this.voices.length) {
      handlers.onError && handlers.onError('no-en-voice'); return;
    }
    this.onError = handlers.onError;
    this.chain = [];
    lines.forEach((ln, li) => {
      this.chunks(ln.t).forEach((c, ci) => {
        this.chain.push({ text: c, s: ln.s, gap: (ci === 0 && li > 0) ? 450 : 60 });
      });
    });
    this.idx = 0; this.playing = true;
    this.onEnd = handlers.onEnd; this.onProgress = handlers.onProgress;
    this.rate = rate || 1;
    this.keepAlive = setInterval(() => {
      if (this.playing && speechSynthesis.speaking) { speechSynthesis.pause(); speechSynthesis.resume(); }
    }, 8000);
    this._next();
  },
  /* 卡死看门狗：Chrome 的语音合成偶尔既不发声也不回调，
     没有它界面会永远停在「正在播放」 */
  _arm() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (!this.playing) return;
      const f = this.onError; this.stop(); f && f('stalled');
    }, 25000);
  },
  _next() {
    if (!this.playing) return;
    if (this.idx >= this.chain.length) { this._finish(); return; }
    const step = this.chain[this.idx++];
    this._arm();
    setTimeout(() => {
      if (!this.playing) return;
      const u = new SpeechSynthesisUtterance(step.text);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else { u.lang = 'en-GB'; }
      u.rate = this.rate;
      u.pitch = step.s === 'M' ? 0.72 : step.s === 'W' ? 1.28 : 1.0;
      u.volume = 1;
      u.onend = () => this._next();
      u.onerror = () => this._next();
      this.onProgress && this.onProgress(this.idx, this.chain.length);
      try { speechSynthesis.speak(u); } catch (e) { this._next(); }
    }, step.gap);
  },
  _finish() {
    this.playing = false;
    clearInterval(this.keepAlive); clearTimeout(this.watchdog);
    const f = this.onEnd; this.onEnd = this.onError = null;
    f && f();
  },
  stop() {
    this.playing = false;
    clearInterval(this.keepAlive); clearTimeout(this.watchdog);
    this.onEnd = this.onError = null;
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { } }
  }
};

/* ---------------------------------------------------------- 计时 ---- */
function startTimer(seconds, label, onEnd) {
  stopTimer();
  const box = $('#timer'), val = $('#timer-value'), lab = $('#timer-label');
  box.classList.remove('hidden'); lab.textContent = label || '剩余';
  let left = seconds;
  const tick = () => {
    val.textContent = fmtTime(left);
    box.classList.toggle('low', left <= 60);
    if (left <= 0) { stopTimer(); onEnd && onEnd(); return; }
    left--;
  };
  tick();
  S.timerId = setInterval(tick, 1000);
}
function stopTimer() {
  if (S.timerId) clearInterval(S.timerId);
  S.timerId = null;
  const box = $('#timer'); if (box) box.classList.add('hidden');
}

/* ------------------------------------------------------ 通知发送 ---- */
function examMeta() {
  const e = S.exam;
  return {
    code: e.code, name: e.name || '(未署名)', vocab: e.vocab,
    band: e.band.cefr + ' · ' + e.band.name,
    neighbor: e.neighbor.cefr,
    paper: e.reading.items.length + ' 篇阅读 / ' + totalQs(e.reading) + ' 题，'
      + e.listening.items.length + ' 段听力 / ' + totalQs(e.listening) + ' 题，'
      + e.writing.tasks.length + ' 篇写作，' + e.speaking.tasks.length + ' 题口语'
  };
}

/* 开始考试 —— 立即把考生信息和开始时间发给考官 */
async function notifyStart() {
  if (S.mail.start && S.mail.start.ok) return;
  S.startedAt = S.startedAt || nowStamp();
  const payload = Object.assign({ kind: 'start', startedAt: S.startedAt, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', ua: navigator.userAgent }, examMeta());
  const r = await MAIL.sendTimeout(payload, 12000);
  S.mail.start = r;
  if (!r.ok && r.mode !== 'none') MAIL.queue(payload);
  persist();
  return r;
}

/* 交卷 —— 先上传录音（可选），再发结果通知 */
async function notifyFinish(onProgress) {
  const e = S.exam, r = S.result;
  S.finishedAt = S.finishedAt || nowStamp();

  const speaking = [];
  for (let i = 0; i < e.speaking.tasks.length; i++) {
    const a = S.ans.speaking[i];
    if (!a) { speaking.push({ task: i + 1, file: null, note: '未提交音频' }); continue; }
    const mb = a.size / 1048576;
    if (!EET_CONFIG.SEND_AUDIO || MAIL.mode() === 'none') { speaking.push({ task: i + 1, file: a.name, note: '未上传' }); continue; }
    if (mb > EET_CONFIG.MAX_AUDIO_MB) { speaking.push({ task: i + 1, file: a.name, note: '文件 ' + mb.toFixed(1) + 'MB，超过上限未上传' }); continue; }
    onProgress && onProgress('正在上传口语录音 ' + (i + 1) + '/' + e.speaking.tasks.length + '…');
    const up = await MAIL.sendTimeout({
      kind: 'audio', code: e.code, name: e.name, task: i + 1,
      filename: a.name, mime: a.type, b64: await blobToB64(a.blob)
    }, 120000);
    speaking.push({ task: i + 1, file: a.name, url: (up.detail && /^https?:/.test(up.detail)) ? up.detail : null, note: up.ok ? '' : ('上传失败：' + up.detail) });
  }

  onProgress && onProgress('正在发送结果邮件…');
  const payload = Object.assign({
    kind: 'finish',
    startedAt: S.startedAt, finishedAt: S.finishedAt,
    duration: durationText(),
    reading: r.reading, listening: r.listening,
    percent: Math.round(r.pct * 100),
    estLevel: r.estBand.cefr + ' · ' + r.estBand.name,
    estVocab: r.estVocab, note: r.note,
    writing: e.writing.tasks.map((t, i) => ({
      task: i + 1, required: t.minWords + '-' + t.maxWords,
      words: words(S.ans.writing[i] || ''), prompt: t.prompt, text: S.ans.writing[i] || '(未作答)'
    })),
    speaking: speaking,
    reportHtml: reportHTML(r)
  }, examMeta());

  const res = await MAIL.sendTimeout(payload, 60000);
  S.mail.finish = res;
  if (!res.ok && res.mode !== 'none') { const light = Object.assign({}, payload); delete light.reportHtml; MAIL.queue(light); }
  persist();
  return res;
}

function durationText() {
  if (!S.startedAt || !S.finishedAt) return '';
  const ms = new Date(S.finishedAt.replace(/-/g, '/')) - new Date(S.startedAt.replace(/-/g, '/'));
  if (!(ms > 0)) return '';
  if (ms < 60000) return Math.round(ms / 1000) + ' 秒';
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟' : m + ' 分钟';
}
function blobToB64(b) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.readAsDataURL(b);
  });
}

/* ---------------------------------------------------------- 导航 ---- */
function setStep(name) {
  const bar = $('#steps');
  if (name === 'setup' || name === 'brief' || name === 'result') { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const order = SECTION_ORDER;
  const cur = order.indexOf(name);
  $$('#steps li').forEach(li => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle('active', i === cur);
    li.classList.toggle('done', i < cur);
  });
}
function go(screen) {
  TTS.stop(); stopTimer();
  S.screen = screen; persist();
  setStep(screen);
  window.scrollTo(0, 0);
  ({ setup: renderSetup, brief: renderBrief, reading: renderReading, listening: renderListening, writing: renderWriting, speaking: renderSpeaking, submit: renderSubmit, result: renderResult }[screen])();
  updateTopMeta();
}
function updateTopMeta() {
  const m = $('#topmeta');
  if (!S.exam || S.screen === 'setup') { m.textContent = ''; return; }
  m.innerHTML = esc(S.exam.name || '考生') + ' · ' + esc(S.exam.band.cefr) + ' 卷<br><span style="opacity:.7">编号 ' + esc(S.exam.code) + '</span>';
}

/* ========================================================== 1. 设置 ==== */
function renderSetup() {
  const lastCode = localStorage.getItem('eet:last');
  const saved = lastCode ? loadSaved(lastCode) : null;
  const resumable = saved && !saved.submitted;

  APP.innerHTML = `
  <div class="card">
    <h1>创建一份英语能力测试卷</h1>
    <p class="lead">输入考生的大致词汇量，系统按对应水平档位出卷。同一个「试卷编号」永远生成同一份卷子，方便复测与对照。</p>

    ${resumable ? `<div class="notice">检测到一份未完成的答卷：<b>${esc(saved.cfg.name || '未署名')}</b>（编号 ${esc(saved.cfg.code)}，词汇量 ${saved.cfg.vocab}）。
      <button class="ghost small" id="btn-resume" style="margin-left:8px">继续作答</button>
      <button class="ghost small" id="btn-drop">丢弃</button></div>` : ''}

    <div class="row">
      <div class="field">
        <label for="f-name">考生姓名</label>
        <input type="text" id="f-name" placeholder="例：Wang Lei">
      </div>
      <div class="field">
        <label for="f-vocab">词汇量（个）</label>
        <input type="number" id="f-vocab" min="300" max="30000" step="100" value="4000">
        <div class="hint">这个数字决定卷子的难度档位。</div>
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="f-seed">试卷编号（留空自动生成）</label>
        <input type="text" id="f-seed" placeholder="例：0819-A">
        <div class="hint">相同编号 + 相同词汇量 = 完全相同的一份卷。</div>
      </div>
      <div class="field">
        <label for="f-voice">听力朗读语音</label>
        <select id="f-voice"><option>正在加载语音…</option></select>
        <div id="voice-warn"></div>
        <div class="hint">听力由浏览器语音合成朗读，男女角色以音高区分。</div>
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="f-play">听力每段可播放次数</label>
        <select id="f-play"><option value="1">1 次（接近真实考试）</option><option value="2" selected>2 次</option><option value="99">不限次数</option></select>
      </div>
      <div class="field">
        <label for="f-wc">写作题数</label>
        <select id="f-wc"><option value="1">1 题</option><option value="2" selected>2 题（一短一长）</option></select>
      </div>
      <div class="field">
        <label for="f-sc">口语题数</label>
        <select id="f-sc"><option value="1">1 题</option><option value="2" selected>2 题</option><option value="3">3 题</option></select>
      </div>
    </div>

    <div class="field">
      <label>考试选项</label>
      <label class="check"><input type="checkbox" id="f-enforce" checked> 分部分限时，时间到自动进入下一部分</label>
      <label class="check"><input type="checkbox" id="f-practice"> 练习模式（交卷后逐题显示正确答案与听力原文）</label>
    </div>

    <div class="actions">
      <button class="primary" id="btn-make">生成试卷</button>
      <span class="spacer"></span>
      <span class="small muted">题库 ${EXAM_BANK.bands.length} 档 · 邮件通知：${MAIL.modeText()}</span>
    </div>
    ${MAIL.mode() === 'none' ? '<div class="notice small" style="margin-top:12px">当前没有配置邮件服务，考试可以正常进行，但<b>不会自动发通知给考官</b>。配置方法见 <code>项目日志.md</code> 的「部署到公网 + 邮件通知」一节。</div>' : ''}
  </div>

  <div id="preview"></div>`;

  /* 语音列表 */
  TTS.init(() => {
    const sel = $('#f-voice'), warn = $('#voice-warn');
    if (!sel || !warn) return;                       // 已离开设置页
    if (!TTS.voices.length) {
      sel.innerHTML = '<option value="">（本机没有英文语音包）</option>';
      warn.innerHTML = '<div class="notice bad small" style="margin-top:8px">未找到英文语音，听力将无法朗读。建议改用 Chrome / Edge 打开，或在系统设置里安装英文语音包；也可以在生成后用「打印试卷」把听力原文交给考官朗读。</div>';
      return;
    }
    warn.innerHTML = '';
    sel.innerHTML = TTS.voices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
    if (TTS.voice) sel.value = TTS.voice.voiceURI;
    sel.onchange = () => TTS.setVoice(sel.value);
  });

  $('#btn-make').onclick = () => {
    const name = $('#f-name').value.trim();
    const vocab = parseInt($('#f-vocab').value, 10);
    if (!vocab || vocab < 100) { alert('请输入一个合理的词汇量数字（例如 4000）。'); return; }
    let seedText = $('#f-seed').value.trim();
    if (!seedText) seedText = todayStr().replace(/-/g, '').slice(4) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    const cfg = {
      name, vocab, seedText,
      code: seedText,
      seed: hashStr(seedText + '|' + vocab),
      playLimit: parseInt($('#f-play').value, 10),
      writingCount: parseInt($('#f-wc').value, 10),
      speakingCount: parseInt($('#f-sc').value, 10),
      enforce: $('#f-enforce').checked,
      practice: $('#f-practice').checked,
      voiceURI: TTS.voice ? TTS.voice.voiceURI : ''
    };
    S.cfg = cfg;
    S.exam = buildExam(cfg);
    S.ans = { reading: {}, listening: {}, writing: [], speaking: [] };
    S.plays = {};
    S.submitted = false;
    renderPreview();
  };

  if (resumable) {
    $('#btn-resume').onclick = () => {
      S.cfg = saved.cfg;
      TTS.init(() => { if (S.cfg.voiceURI) TTS.setVoice(S.cfg.voiceURI); });
      S.exam = buildExam(S.cfg);
      S.ans = { reading: saved.ans.reading || {}, listening: saved.ans.listening || {}, writing: saved.ans.writing || [], speaking: [] };
      S.plays = saved.plays || {};
      S.submitted = false;
      alert('已恢复文字作答。注意：口语录音无法跨刷新保存，需要重新上传。');
      go(saved.screen === 'result' ? 'submit' : (saved.screen || 'brief'));
    };
    $('#btn-drop').onclick = () => { localStorage.removeItem('eet:' + saved.cfg.code); localStorage.removeItem('eet:last'); renderSetup(); };
  }
}

function renderPreview() {
  const e = S.exam;
  const nbNote = e.neighbor.id === e.band.id ? '（无相邻档，全部取自本档）' : `，另有 1 篇阅读 + 1 段听力取自 <b>${e.neighbor.cefr}</b> 档用于拉开区分度`;
  $('#preview').innerHTML = `
  <div class="card">
    <h2>试卷已生成 <span class="badge">${esc(e.band.cefr)} · ${esc(e.band.name)}</span></h2>
    <p class="lead">词汇量 ${e.vocab} 落在 <b>${esc(e.band.cefr)}</b> 档（${esc(e.band.vocabHint)}）${nbNote}。</p>
    <dl class="kv">
      <dt>试卷编号</dt><dd>${esc(e.code)}</dd>
      <dt>考生</dt><dd>${esc(e.name || '（未填写）')}</dd>
      <dt>阅读</dt><dd>${e.reading.items.length} 篇文章 · ${totalQs(e.reading)} 题选择 · ${e.reading.minutes} 分钟</dd>
      <dt>听力</dt><dd>${e.listening.items.length} 段材料 · ${totalQs(e.listening)} 题选择 · 每段可播 ${S.cfg.playLimit >= 99 ? '不限' : S.cfg.playLimit} 次</dd>
      <dt>写作</dt><dd>${e.writing.tasks.length} 题 · 共 ${e.writing.minutes} 分钟</dd>
      <dt>口语</dt><dd>${e.speaking.tasks.length} 题 · 上传音频或现场录音</dd>
    </dl>
    <div class="actions">
      <button class="primary" id="btn-link">复制考生链接</button>
      <button class="ghost" id="btn-start">在本机直接开考</button>
      <button class="ghost" id="btn-print">打印试卷（含听力原文与答案）</button>
      <button class="ghost" id="btn-back">重新设置</button>
    </div>
    <div id="link-out" class="small muted" style="margin-top:10px"></div>
  </div>`;
  $('#btn-start').onclick = () => go('brief');
  $('#btn-print').onclick = openPrintable;
  $('#btn-back').onclick = () => { S.exam = null; renderSetup(); };
  $('#btn-link').onclick = () => {
    const p = new URLSearchParams({ v: String(e.vocab), code: e.code, w: String(S.cfg.writingCount), s: String(S.cfg.speakingCount), p: String(S.cfg.playLimit) });
    if (e.name) p.set('name', e.name);
    const link = baseUrl() + '?' + p.toString();
    const out = $('#link-out');
    out.innerHTML = '把这个链接发给考生，他打开就能直接考（无需填任何设置）：<br><code style="word-break:break-all">' + esc(link) + '</code>';
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(
      () => out.insertAdjacentHTML('beforeend', '<br><span class="tick">✔ 已复制到剪贴板</span>'),
      () => { });
  };
}

/* ========================================================== 2. 须知 ==== */
function renderBrief() {
  const e = S.exam;
  const needName = !e.name;
  APP.innerHTML = `
  <div class="card">
    <h1>考试须知 Instructions</h1>
    <p class="lead">全卷共四个部分，按顺序作答。<b>进入下一部分后不能返回。</b></p>
    ${needName ? `<div class="field" style="max-width:360px">
      <label for="f-cname">请先填写你的姓名 Your name</label>
      <input type="text" id="f-cname" placeholder="姓名 / Name">
    </div>` : ''}
    <table class="rubric">
      <tr><th>部分</th><th>内容</th><th>时间</th></tr>
      <tr><td>Reading 阅读</td><td>${e.reading.items.length} 篇文章，${totalQs(e.reading)} 道单选题</td><td>${e.reading.minutes} 分钟</td></tr>
      <tr><td>Listening 听力</td><td>${e.listening.items.length} 段材料，${totalQs(e.listening)} 道单选题；每段可播放 ${S.cfg.playLimit >= 99 ? '不限' : S.cfg.playLimit} 次</td><td>约 ${e.listening.minutes} 分钟</td></tr>
      <tr><td>Writing 写作</td><td>${e.writing.tasks.length} 篇写作，注意字数要求</td><td>${e.writing.minutes} 分钟</td></tr>
      <tr><td>Speaking 口语</td><td>${e.speaking.tasks.length} 题，按题目录音后上传音频文件</td><td>不限时</td></tr>
    </table>
    <hr>
    <h3>请先确认</h3>
    <ul class="small">
      <li>听力由电脑朗读，请先把音量调好；戴耳机效果更佳。</li>
      <li>口语部分需要准备好录音文件（手机录音即可，常见格式 m4a / mp3 / wav / webm 都支持），也可以在页面上直接用麦克风录。</li>
      <li>考试过程中请不要关闭浏览器；文字作答会自动暂存，录音不会。</li>
      <li>点击「开始」即表示你同意：你的<b>姓名、开始与结束时间、作答内容和口语录音</b>将发送给考官用于评分。</li>
    </ul>
    <div class="actions">
      <button class="primary" id="btn-go">开始 Reading 阅读</button>
      ${S.fromLink ? '' : '<button class="ghost" id="btn-cancel">返回设置</button>'}
      <span class="spacer"></span>
      <span class="small muted" id="brief-mail"></span>
    </div>
  </div>`;
  $('#btn-go').onclick = () => {
    if (needName) {
      const n = $('#f-cname').value.trim();
      if (!n) { alert('请先填写姓名。'); $('#f-cname').focus(); return; }
      S.exam.name = n; S.cfg.name = n;
    }
    const st = $('#brief-mail'); if (st) st.textContent = '正在通知考官…';
    notifyStart().then(() => go('reading'), () => go('reading'));
  };
  if ($('#btn-cancel')) $('#btn-cancel').onclick = () => { S.exam = null; go('setup'); };
}

/* ========================================================== 3. 阅读 ==== */
function renderReading() {
  const e = S.exam;
  let html = `<div class="card"><h1>Part 1 · Reading 阅读</h1>
    <p class="lead">共 ${totalQs(e.reading)} 题，每题只有一个正确答案。限时 ${e.reading.minutes} 分钟。</p></div>`;

  e.reading.items.forEach((it, ii) => {
    html += `<div class="card">
      <div class="passage-title">Passage ${ii + 1} — ${esc(it.title)}</div>
      <div class="passage">${esc(it.text)}</div>
      ${it.qs.map(q => qHTML(q, 'reading')).join('')}
    </div>`;
  });

  html += `<div class="card"><div class="actions">
      <span class="small muted" id="r-progress"></span>
      <span class="spacer"></span>
      <button class="primary" id="btn-next">交卷并进入 Listening 听力</button>
    </div></div>`;
  APP.innerHTML = html;
  bindQs('reading', () => updateProgress('reading', '#r-progress'));
  updateProgress('reading', '#r-progress');

  $('#btn-next').onclick = () => {
    const left = totalQs(e.reading) - Object.keys(S.ans.reading).length;
    if (left > 0 && !confirm('还有 ' + left + ' 题未作答。进入下一部分后无法返回，确定继续吗？')) return;
    go('listening');
  };
  startTimer(e.reading.minutes * 60, '阅读剩余', () => {
    alert('阅读部分时间到。');
    if (S.cfg.enforce) go('listening');
  });
}

function qHTML(q, sec) {
  const chosen = S.ans[sec][q.id];
  return `<div class="qblock" data-q="${q.id}">
    <div class="qtext"><span class="num">${q.id.slice(1)}.</span>${esc(q.q)}</div>
    ${q.options.map((o, i) => `
      <label class="opt${chosen === i ? ' sel' : ''}" data-i="${i}">
        <input type="radio" name="${q.id}" value="${i}"${chosen === i ? ' checked' : ''}>${esc(o)}
      </label>`).join('')}
  </div>`;
}
function bindQs(sec, cb) {
  $$('.qblock').forEach(block => {
    const id = block.dataset.q;
    $$('.opt', block).forEach(opt => {
      opt.onclick = () => {
        S.ans[sec][id] = parseInt(opt.dataset.i, 10);
        $$('.opt', block).forEach(o => o.classList.remove('sel'));
        opt.classList.add('sel');
        $('input', opt).checked = true;
        persist(); cb && cb();
      };
    });
  });
}
function updateProgress(sec, target) {
  const t = $(target); if (!t) return;
  const done = Object.keys(S.ans[sec]).length, all = totalQs(S.exam[sec]);
  t.textContent = '已作答 ' + done + ' / ' + all + ' 题';
}

/* ========================================================== 4. 听力 ==== */
function renderListening() {
  const e = S.exam;
  const noVoice = !TTS.voices.length;
  let html = `<div class="card"><h1>Part 2 · Listening 听力</h1>
    <p class="lead">共 ${totalQs(e.listening)} 题。先看题，再点播放；每段最多播放 ${S.cfg.playLimit >= 99 ? '不限' : S.cfg.playLimit} 次。</p>
    ${noVoice ? '<div class="notice bad">本机浏览器没有可用的英文语音，无法自动朗读。请改用 Chrome / Edge，或让考官照「打印试卷」里的听力原文朗读。</div>' : ''}
    </div>`;

  e.listening.items.forEach((it, ii) => {
    const used = (S.plays && S.plays[ii]) || 0;
    html += `<div class="card">
      <h3>Section ${ii + 1} — ${esc(it.title)}</h3>
      <div class="audio-box" data-item="${ii}">
        <button class="primary btn-play" data-item="${ii}"${used >= S.cfg.playLimit ? ' disabled' : ''}>▶ 播放</button>
        <button class="ghost btn-stop" data-item="${ii}" disabled>停止</button>
        <span class="status" id="st-${ii}">${used >= S.cfg.playLimit ? '已用完播放次数' : '剩余播放 ' + (S.cfg.playLimit >= 99 ? '不限' : (S.cfg.playLimit - used)) + ' 次'}</span>
      </div>
      ${it.qs.map(q => qHTML(q, 'listening')).join('')}
    </div>`;
  });

  html += `<div class="card"><div class="actions">
      <span class="small muted" id="l-progress"></span>
      <span class="spacer"></span>
      <button class="primary" id="btn-next">交卷并进入 Writing 写作</button>
    </div></div>`;
  APP.innerHTML = html;
  bindQs('listening', () => updateProgress('listening', '#l-progress'));
  updateProgress('listening', '#l-progress');

  $$('.btn-play').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.item, 10);
      playItem(i, btn);
    };
  });
  $$('.btn-stop').forEach(btn => {
    btn.onclick = () => { TTS.stop(); resetAudioUI(); };
  });

  $('#btn-next').onclick = () => {
    const left = totalQs(e.listening) - Object.keys(S.ans.listening).length;
    if (left > 0 && !confirm('还有 ' + left + ' 题未作答。进入下一部分后无法返回，确定继续吗？')) return;
    TTS.stop(); go('writing');
  };
  startTimer(e.listening.minutes * 60, '听力剩余', () => {
    alert('听力部分时间到。');
    if (S.cfg.enforce) { TTS.stop(); go('writing'); }
  });
}

function playItem(i, btn) {
  const it = S.exam.listening.items[i];
  S.plays = S.plays || {};
  const used = S.plays[i] || 0;
  if (used >= S.cfg.playLimit) return;
  S.plays[i] = used + 1; persist();

  $$('.btn-play').forEach(b => b.disabled = true);
  $$('.btn-stop').forEach(b => b.disabled = (parseInt(b.dataset.item, 10) !== i));
  const st = $('#st-' + i);
  st.innerHTML = '<span class="speakwave"><i></i><i></i><i></i><i></i></span> 正在播放…';

  TTS.speak(it.lines, S.exam.listening.rate, {
    onEnd: () => {
      const left = S.cfg.playLimit >= 99 ? '不限' : (S.cfg.playLimit - S.plays[i]);
      st.textContent = S.plays[i] >= S.cfg.playLimit ? '已用完播放次数' : '剩余播放 ' + left + ' 次';
      resetAudioUI();
    },
    onError: reason => {
      S.plays[i] = Math.max(0, (S.plays[i] || 1) - 1);   // 没播出声就不扣次数
      persist();
      st.textContent = reason === 'stalled'
        ? '朗读中断，本次不计入播放次数，请再点一次播放。'
        : '朗读失败：本机没有可用的英文语音。请改用 Chrome / Edge，或让考官照打印稿里的听力原文朗读。';
      resetAudioUI();
    }
  });
}
function resetAudioUI() {
  $$('.btn-play').forEach(b => {
    const i = parseInt(b.dataset.item, 10);
    b.disabled = ((S.plays && S.plays[i]) || 0) >= S.cfg.playLimit;
  });
  $$('.btn-stop').forEach(b => b.disabled = true);
}

/* ========================================================== 5. 写作 ==== */
function renderWriting() {
  const e = S.exam;
  let html = `<div class="card"><h1>Part 3 · Writing 写作</h1>
    <p class="lead">共 ${e.writing.tasks.length} 题，建议总用时 ${e.writing.minutes} 分钟。字数不足或严重超出都会影响评分。</p></div>`;

  e.writing.tasks.forEach((t, i) => {
    const val = S.ans.writing[i] || '';
    html += `<div class="card">
      <h3>Task ${i + 1} · ${t.type === 'short' ? '应用文' : '短文写作'} <span class="badge">${t.minWords}–${t.maxWords} words · 建议 ${t.minutes} 分钟</span></h3>
      <div class="prompt">${esc(t.prompt)}</div>
      <textarea class="essay" data-i="${i}" placeholder="Write your answer here…">${esc(val)}</textarea>
      <div class="wc" id="wc-${i}"></div>
    </div>`;
  });

  html += `<div class="card"><div class="actions">
      <span class="spacer"></span>
      <button class="primary" id="btn-next">交卷并进入 Speaking 口语</button>
    </div></div>`;
  APP.innerHTML = html;

  $$('textarea.essay').forEach(ta => {
    const i = parseInt(ta.dataset.i, 10);
    const upd = () => {
      S.ans.writing[i] = ta.value;
      const n = words(ta.value), t = e.writing.tasks[i];
      const cls = n < t.minWords ? '' : (n > t.maxWords ? 'over' : 'ok');
      $('#wc-' + i).innerHTML = `字数 <b class="${cls}">${n}</b>　要求 ${t.minWords}–${t.maxWords}　`
        + (n < t.minWords ? `<span class="muted">还差 ${t.minWords - n} 词</span>`
          : n > t.maxWords ? `<span class="over">已超出 ${n - t.maxWords} 词</span>` : `<span class="ok">符合要求</span>`);
    };
    ta.oninput = () => { upd(); clearTimeout(ta._t); ta._t = setTimeout(persist, 600); };
    upd();
  });

  $('#btn-next').onclick = () => {
    const empty = e.writing.tasks.filter((t, i) => words(S.ans.writing[i] || '') < 10).length;
    if (empty > 0 && !confirm('有 ' + empty + ' 题几乎没有作答。进入下一部分后无法返回，确定继续吗？')) return;
    go('speaking');
  };
  startTimer(e.writing.minutes * 60, '写作剩余', () => {
    alert('写作部分时间到。');
    if (S.cfg.enforce) go('speaking');
  });
}

/* ========================================================== 6. 口语 ==== */
const REC = { stream: null, rec: null, chunks: [], activeIdx: -1, timerId: null };

function renderSpeaking() {
  const e = S.exam;
  let html = `<div class="card"><h1>Part 4 · Speaking 口语</h1>
    <p class="lead">共 ${e.speaking.tasks.length} 题。按题目要求录音，然后上传音频文件；也可以点「现场录音」直接用麦克风录。</p>
    <div class="notice">建议流程：读题 → 按提示的准备时间构思 → 录音 → 上传。手机录音后传到电脑再上传也完全可以。</div></div>`;

  e.speaking.tasks.forEach((t, i) => {
    html += `<div class="card">
      <h3>Task ${i + 1} <span class="badge">准备 ${t.prepSec}s · 作答约 ${Math.round(t.speakSec / 60 * 10) / 10} 分钟</span></h3>
      <div class="prompt">${esc(t.prompt)}</div>
      <div class="rec-box">
        <div class="rec-row">
          <button class="ghost btn-prep" data-i="${i}">开始准备计时</button>
          <button class="ghost btn-rec" data-i="${i}">● 现场录音</button>
          <button class="ghost btn-stoprec" data-i="${i}" disabled>停止录音</button>
          <span id="rst-${i}" class="small muted"></span>
        </div>
        <div class="rec-row">
          <label class="small">上传音频文件：</label>
          <input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" data-i="${i}" class="f-audio">
        </div>
        <div id="prev-${i}"></div>
      </div>
    </div>`;
  });

  html += `<div class="card"><div class="actions">
      <span class="spacer"></span>
      <button class="primary" id="btn-next">完成，去检查并交卷</button>
    </div></div>`;
  APP.innerHTML = html;

  e.speaking.tasks.forEach((t, i) => { if (S.ans.speaking[i]) showAudio(i); });

  $$('.btn-prep').forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.i, 10), t = e.speaking.tasks[i];
    let left = t.prepSec;
    const st = $('#rst-' + i);
    clearInterval(REC.timerId);
    REC.timerId = setInterval(() => {
      st.textContent = '准备中… ' + left + ' 秒';
      if (left-- <= 0) { clearInterval(REC.timerId); st.textContent = '准备结束，可以开始录音了。'; }
    }, 1000);
  });

  $$('.btn-rec').forEach(b => b.onclick = () => startRec(parseInt(b.dataset.i, 10)));
  $$('.btn-stoprec').forEach(b => b.onclick = () => stopRec());
  $$('.f-audio').forEach(inp => inp.onchange = () => {
    const i = parseInt(inp.dataset.i, 10), f = inp.files[0];
    if (!f) return;
    S.ans.speaking[i] = { blob: f, name: f.name, type: f.type || 'audio/mpeg', size: f.size, source: 'upload' };
    showAudio(i); persist();
  });

  $('#btn-next').onclick = () => {
    stopRec();
    const missing = e.speaking.tasks.filter((t, i) => !S.ans.speaking[i]).length;
    if (missing > 0 && !confirm('还有 ' + missing + ' 题没有音频。确定继续交卷吗？')) return;
    go('submit');
  };
}

function startRec(i) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('这个浏览器/打开方式不支持现场录音，请改用「上传音频文件」。'); return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    REC.stream = stream; REC.chunks = []; REC.activeIdx = i;
    let mime = '';
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].some(m => {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
      return false;
    });
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    REC.rec = rec;
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) REC.chunks.push(ev.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(REC.chunks, { type });
      const ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      S.ans.speaking[i] = { blob, name: 'recording_task' + (i + 1) + '.' + ext, type, size: blob.size, source: 'record' };
      showAudio(i); persist();
      if (REC.stream) REC.stream.getTracks().forEach(t => t.stop());
      REC.stream = null; REC.rec = null; REC.activeIdx = -1;
      $$('.btn-rec').forEach(b => b.disabled = false);
      $$('.btn-stoprec').forEach(b => b.disabled = true);
    };
    rec.start();
    $$('.btn-rec').forEach(b => b.disabled = true);
    $$('.btn-stoprec').forEach(b => b.disabled = (parseInt(b.dataset.i, 10) !== i));
    const st = $('#rst-' + i);
    let sec = 0;
    clearInterval(REC.timerId);
    REC.timerId = setInterval(() => { sec++; st.innerHTML = '<span class="dot"></span> 录音中 ' + fmtTime(sec); }, 1000);
    st.innerHTML = '<span class="dot"></span> 录音中 00:00';
  }).catch(err => {
    alert('无法使用麦克风（' + err.name + '）。请改用「上传音频文件」，或把网站用本地服务器打开（见 启动.ps1）。');
  });
}
function stopRec() {
  clearInterval(REC.timerId);
  if (REC.rec && REC.rec.state !== 'inactive') { try { REC.rec.stop(); } catch (e) { } }
  const st = REC.activeIdx >= 0 ? $('#rst-' + REC.activeIdx) : null;
  if (st) st.textContent = '录音已保存。';
}
function showAudio(i) {
  const a = S.ans.speaking[i]; if (!a) return;
  const box = $('#prev-' + i); if (!box) return;
  const url = URL.createObjectURL(a.blob);
  const size = a.size >= 1048576 ? (a.size / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(a.size / 1024)) + ' KB';
  box.innerHTML = `<div class="small filetag">✔ 已保存：${esc(a.name)}（${size}，${a.source === 'record' ? '现场录音' : '上传'}）</div>
    <audio controls src="${url}"></audio>
    <div><button class="ghost small btn-clear" data-i="${i}" style="margin-top:6px">删除重录</button></div>`;
  $('.btn-clear', box).onclick = () => { S.ans.speaking[i] = null; box.innerHTML = ''; persist(); };
}

/* ========================================================== 7. 交卷 ==== */
function renderSubmit() {
  const e = S.exam;
  const rDone = Object.keys(S.ans.reading).length, lDone = Object.keys(S.ans.listening).length;
  const wRows = e.writing.tasks.map((t, i) => {
    const n = words(S.ans.writing[i] || '');
    return `<tr><td>写作 Task ${i + 1}</td><td>${n} 词 / 要求 ${t.minWords}–${t.maxWords}</td>
      <td>${n >= t.minWords ? '<span class="tick">✔</span>' : '<span class="cross">字数不足</span>'}</td></tr>`;
  }).join('');
  const sRows = e.speaking.tasks.map((t, i) => {
    const a = S.ans.speaking[i];
    return `<tr><td>口语 Task ${i + 1}</td><td>${a ? esc(a.name) : '（无音频）'}</td>
      <td>${a ? '<span class="tick">✔</span>' : '<span class="cross">缺少音频</span>'}</td></tr>`;
  }).join('');

  APP.innerHTML = `
  <div class="card">
    <h1>交卷前检查</h1>
    <p class="lead">确认无误后点击「正式交卷」。交卷后系统自动评阅阅读与听力，写作与口语交由人工评分。</p>
    <table class="rubric">
      <tr><th>部分</th><th>完成情况</th><th></th></tr>
      <tr><td>阅读</td><td>${rDone} / ${totalQs(e.reading)} 题</td><td>${rDone === totalQs(e.reading) ? '<span class="tick">✔</span>' : '<span class="cross">有漏题</span>'}</td></tr>
      <tr><td>听力</td><td>${lDone} / ${totalQs(e.listening)} 题</td><td>${lDone === totalQs(e.listening) ? '<span class="tick">✔</span>' : '<span class="cross">有漏题</span>'}</td></tr>
      ${wRows}${sRows}
    </table>
    <div class="actions">
      <button class="primary" id="btn-submit">正式交卷</button>
      <button class="ghost" id="btn-back-speaking">回到口语部分补录</button>
    </div>
  </div>`;
  $('#btn-submit').onclick = async () => {
    if (!confirm('交卷后不能再修改答案，确定吗？')) return;
    S.submitted = true; S.result = grade(); persist();
    const btn = $('#btn-submit');
    btn.disabled = true;
    const say = m => { btn.textContent = m; };
    say('正在提交…');
    try { await notifyFinish(say); } catch (e) { S.mail.finish = { ok: false, mode: MAIL.mode(), detail: e.message }; }
    go('result');
  };
  $('#btn-back-speaking').onclick = () => go('speaking');
}

/* ========================================================== 8. 评分 ==== */
function grade() {
  const e = S.exam;
  const detail = { reading: [], listening: [] };
  let rC = 0, lC = 0;
  e.reading.items.forEach(it => it.qs.forEach(q => {
    const got = S.ans.reading[q.id];
    const ok = got === q.answer; if (ok) rC++;
    detail.reading.push({ id: q.id, q: q.q, options: q.options, answer: q.answer, got: got, ok: ok });
  }));
  e.listening.items.forEach(it => it.qs.forEach(q => {
    const got = S.ans.listening[q.id];
    const ok = got === q.answer; if (ok) lC++;
    detail.listening.push({ id: q.id, q: q.q, options: q.options, answer: q.answer, got: got, ok: ok });
  }));
  const rT = totalQs(e.reading), lT = totalQs(e.listening);
  const pct = (rC + lC) / (rT + lT);

  const bs = EXAM_BANK.bands, bi = bs.indexOf(e.band);
  let est = e.band, note;
  if (pct >= 0.85 && bi < bs.length - 1) { est = bs[bi + 1]; note = '客观题正确率很高，这份卷子对他偏容易，实际水平可能在更高一档。'; }
  else if (pct >= 0.7) { note = '客观题表现稳定，与设定档位相符。'; }
  else if (pct >= 0.5) { note = '客观题表现处于本档下沿，接近但尚未稳定达到该水平。'; }
  else if (bi > 0) { est = bs[bi - 1]; note = '客观题正确率偏低，这份卷子对他偏难，实际水平可能在更低一档。'; }
  else { note = '客观题正确率偏低，建议从基础词汇与句型入手。'; }

  return {
    reading: { correct: rC, total: rT },
    listening: { correct: lC, total: lT },
    pct: pct, estBand: est, note: note, detail: detail,
    estVocab: est.max > 90000 ? (est.min + '+') : (est.min + '–' + est.max)
  };
}

const RUBRIC_W = [
  ['5 · 优秀', '完全完成任务要求，观点清晰且有展开；结构自然，衔接手段多样；用词准确且有变化；语法错误极少且不影响理解。'],
  ['4 · 良好', '完成任务要求；结构清楚，衔接基本得当；用词较准确，偶有生硬；有少量语法错误，不影响理解。'],
  ['3 · 合格', '基本完成任务，部分要点展开不足；结构可辨但衔接单一；用词重复；语法错误较多但大意可懂。'],
  ['2 · 偏弱', '任务完成不全，遗漏要点或跑题；结构松散；词汇匮乏；语法错误频繁，影响理解。'],
  ['1 · 很弱', '几乎未完成任务；难以看出结构；仅能写出零散短句。']
];
const RUBRIC_S = [
  ['5 · 优秀', '表达流利自然，几乎无卡顿；发音清晰，语调自然；词汇与句式丰富贴切；语法准确；能主动展开并给出例证。'],
  ['4 · 良好', '基本流利，偶有停顿但不影响交流；发音可懂；词汇够用；语法基本正确；内容较完整。'],
  ['3 · 合格', '有明显停顿和重复；发音个别处需要听者努力；词汇有限、重复较多；语法错误较多；内容能覆盖要点但缺展开。'],
  ['2 · 偏弱', '停顿频繁，需要长时间组织语言；发音影响理解；只能用简单短句；要点覆盖不全。'],
  ['1 · 很弱', '仅能说出孤立词句，难以完成任务。']
];

function renderResult() {
  const e = S.exam, r = S.result || grade();
  S.result = r;
  const objTotal = r.reading.total + r.listening.total;
  const objGot = r.reading.correct + r.listening.correct;

  let html = `
  <div class="card">
    <h1>测试结果</h1>
    <p class="lead">${esc(e.name || '考生')} · 试卷编号 ${esc(e.code)} · ${esc(e.date)} · 按词汇量 ${e.vocab} 出的 ${esc(e.band.cefr)} 卷</p>
    <div class="scorebar">
      <div class="scorecard"><div class="l">Reading 阅读</div><div class="n">${r.reading.correct}<span class="muted" style="font-size:16px"> / ${r.reading.total}</span></div></div>
      <div class="scorecard"><div class="l">Listening 听力</div><div class="n">${r.listening.correct}<span class="muted" style="font-size:16px"> / ${r.listening.total}</span></div></div>
      <div class="scorecard"><div class="l">客观题合计</div><div class="n">${Math.round(r.pct * 100)}<span class="muted" style="font-size:16px">%</span></div><div class="small muted">${objGot} / ${objTotal} 题</div></div>
    </div>
    <div class="levelbox">
      <div class="small muted">客观题推算水平（仅供参考，未含写作口语）</div>
      <div class="lv">${esc(r.estBand.cefr)} · ${esc(r.estBand.name)}</div>
      <div class="small">对应词汇量约 ${esc(r.estVocab)} 词。${esc(r.note)}</div>
    </div>
    ${audioHandoffHTML()}
    ${mailStatusHTML()}
    <div class="actions">
      ${EET_CONFIG.KEEP_LOCAL_ZIP ? '<button class="primary" id="btn-zip">下载结果包（含录音 .zip）</button>' : ''}
      <button class="ghost" id="btn-print2">打印本页</button>
      <button class="ghost" id="btn-new">出下一份卷</button>
    </div>
  </div>

  <div class="card">
    <h2>写作作答（待人工评分）</h2>
    ${e.writing.tasks.map((t, i) => `
      <h3 style="margin-top:14px">Task ${i + 1} · ${words(S.ans.writing[i] || '')} 词（要求 ${t.minWords}–${t.maxWords}）</h3>
      <div class="small muted" style="white-space:pre-wrap;margin-bottom:8px">${esc(t.prompt)}</div>
      <div class="review-answer">${esc(S.ans.writing[i] || '（未作答）')}</div>`).join('')}
    <h3 style="margin-top:18px">写作评分标准</h3>
    <table class="rubric">${RUBRIC_W.map(x => `<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join('')}</table>
  </div>

  <div class="card">
    <h2>口语作答（待人工评分）</h2>
    ${e.speaking.tasks.map((t, i) => {
    const a = S.ans.speaking[i];
    return `<h3 style="margin-top:14px">Task ${i + 1}</h3>
      <div class="small muted" style="white-space:pre-wrap;margin-bottom:8px">${esc(t.prompt)}</div>
      ${a ? `<div class="small filetag">${esc(a.name)}</div><audio controls src="${URL.createObjectURL(a.blob)}"></audio>` : '<div class="small cross">（未提交音频）</div>'}`;
  }).join('')}
    <h3 style="margin-top:18px">口语评分标准</h3>
    <table class="rubric">${RUBRIC_S.map(x => `<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join('')}</table>
  </div>

  <div class="card">
    <details${S.cfg.practice ? ' open' : ''}>
      <summary style="cursor:pointer;font-weight:600;font-size:17px">逐题对照与听力原文（考官查看）</summary>
      ${reviewHTML(r)}
    </details>
  </div>`;

  APP.innerHTML = html;
  if ($('#btn-zip')) $('#btn-zip').onclick = exportZip;
  if ($('#btn-resend')) $('#btn-resend').onclick = async () => {
    const b = $('#btn-resend'); b.disabled = true; b.textContent = '正在补发…';
    if (!S.mail.start || !S.mail.start.ok) await notifyStart();
    await notifyFinish(m => b.textContent = m);
    renderResult();
  };
  $('#btn-print2').onclick = () => window.print();
  $('#btn-new').onclick = () => { if (confirm('放弃当前结果，回到出卷页面？')) { S.exam = null; S.submitted = false; go('setup'); } };
}

/* 口语录音不随通知走（群机器人发不了音频），所以要明确告诉考生：
   得自己下载结果包发给考官。否则口语这部分就悄无声息地丢了。 */
function audioHandoffHTML() {
  const has = S.ans.speaking.filter(Boolean).length;
  if (!has || !EET_CONFIG.KEEP_LOCAL_ZIP) return '';
  const uploaded = MAIL.mode() !== 'none' && EET_CONFIG.SEND_AUDIO;
  if (uploaded) return '';
  return `<div class="notice" style="margin-top:14px">
    <b>还有一步：请把口语录音发给考官</b>
    <div>成绩和写作已经自动发送，但${has} 段口语录音需要你手动提交。</div>
    <div>请点下面的 <b>「下载结果包」</b>，把得到的 zip 文件发给考官（微信或邮件都行）。</div>
  </div>`;
}

function mailStatusHTML() {
  const line = (label, r) => {
    if (!r) return `<div>${label}：<span class="muted">未发送</span></div>`;
    if (r.ok && r.mode === 'gas') return `<div>${label}：<span class="tick">✔ 已发送给考官</span></div>`;
    if (r.ok && r.mode === 'webhook') return `<div>${label}：<span class="tick">✔ 已推送到考官群</span> <span class="muted small">（浏览器读不到对方响应，无法确认对方是否收到）</span></div>`;
    if (r.ok && r.mode === 'http') return `<div>${label}：<span class="tick">✔ 已发出</span> <span class="muted small">（跨域方式无法确认送达，请考官核对收件箱）</span></div>`;
    if (r.mode === 'none') return `<div>${label}：<span class="muted">未配置邮件服务</span></div>`;
    return `<div>${label}：<span class="cross">✘ 发送失败</span> <span class="muted small">${esc(r.detail || '')}</span></div>`;
  };
  const bad = MAIL.mode() !== 'none' && (!S.mail.finish || !S.mail.finish.ok);
  return `<div class="notice${bad ? ' bad' : ''} small" style="margin-top:14px">
    <b>邮件通知</b>
    ${line('开始通知', S.mail.start)}
    ${line('结果通知', S.mail.finish)}
    <div class="muted">开始时间 ${esc(S.startedAt || '—')}　结束时间 ${esc(S.finishedAt || '—')}　用时 ${esc(durationText() || '—')}</div>
    ${bad ? '<button class="ghost small" id="btn-resend" style="margin-top:8px">补发邮件</button>' : ''}
  </div>`;
}

function reviewHTML(r) {
  const e = S.exam;
  let h = '<h3 style="margin-top:14px">阅读 Reading</h3>';
  h += r.detail.reading.map(d => qReviewHTML(d)).join('');
  h += '<h3 style="margin-top:18px">听力 Listening</h3>';
  h += r.detail.listening.map(d => qReviewHTML(d)).join('');
  h += '<h3 style="margin-top:18px">听力原文 Transcripts</h3>';
  e.listening.items.forEach((it, i) => {
    h += `<div class="transcript"><b>Section ${i + 1} — ${esc(it.title)}</b><br>` +
      it.lines.map(l => `<p><span class="sp">${l.s === 'M' ? 'MAN' : l.s === 'W' ? 'WOMAN' : 'NARRATOR'}</span>${esc(l.t)}</p>`).join('') + '</div>';
  });
  return h;
}
function qReviewHTML(d) {
  return `<div class="qblock">
    <div class="qtext"><span class="num">${d.id.slice(1)}.</span>${esc(d.q)} ${d.ok ? '<span class="tick">✔</span>' : '<span class="cross">✘</span>'}</div>
    ${d.options.map((o, i) => {
    let cls = '';
    if (i === d.answer) cls = ' correct';
    else if (i === d.got) cls = ' wrong';
    return `<div class="opt${cls}">${String.fromCharCode(65 + i)}. ${esc(o)}${i === d.got ? ' <span class="small muted">（考生所选）</span>' : ''}</div>`;
  }).join('')}
  </div>`;
}

/* ========================================================== 打印卷 ==== */
function openPrintable() {
  const e = S.exam;
  const key = [];
  let h = `<h1>English Proficiency Test</h1>
  <p>考生：${esc(e.name || '____________')}　词汇量设定：${e.vocab}　档位：${esc(e.band.cefr)}　试卷编号：${esc(e.code)}　日期：${esc(e.date)}</p>
  <h2>Part 1 · Reading（${e.reading.minutes} 分钟）</h2>`;
  e.reading.items.forEach((it, i) => {
    h += `<h3>Passage ${i + 1} — ${esc(it.title)}</h3><div class="p">${esc(it.text)}</div>`;
    it.qs.forEach(q => {
      h += `<p><b>${q.id.slice(1)}.</b> ${esc(q.q)}</p><ol type="A">` + q.options.map(o => `<li>${esc(o)}</li>`).join('') + '</ol>';
      key.push(q.id + ' ' + String.fromCharCode(65 + q.answer));
    });
  });
  h += `<h2>Part 2 · Listening</h2>`;
  e.listening.items.forEach((it, i) => {
    h += `<h3>Section ${i + 1} — ${esc(it.title)}</h3>`;
    it.qs.forEach(q => {
      h += `<p><b>${q.id.slice(1)}.</b> ${esc(q.q)}</p><ol type="A">` + q.options.map(o => `<li>${esc(o)}</li>`).join('') + '</ol>';
      key.push(q.id + ' ' + String.fromCharCode(65 + q.answer));
    });
  });
  h += `<h2>Part 3 · Writing（${e.writing.minutes} 分钟）</h2>`;
  e.writing.tasks.forEach((t, i) => { h += `<h3>Task ${i + 1}（${t.minWords}–${t.maxWords} words）</h3><div class="p">${esc(t.prompt)}</div>`; });
  h += `<h2>Part 4 · Speaking</h2>`;
  e.speaking.tasks.forEach((t, i) => { h += `<h3>Task ${i + 1}</h3><div class="p">${esc(t.prompt)}</div>`; });

  h += `<div style="page-break-before:always"></div><h2>听力原文 Transcripts（考官用）</h2>`;
  e.listening.items.forEach((it, i) => {
    h += `<h3>Section ${i + 1} — ${esc(it.title)}</h3>` +
      it.lines.map(l => `<p><b>${l.s === 'M' ? 'MAN' : l.s === 'W' ? 'WOMAN' : 'NARRATOR'}:</b> ${esc(l.t)}</p>`).join('');
  });
  h += `<h2>参考答案 Answer Key</h2><p style="font-family:monospace">${key.join('　')}</p>`;

  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出窗口后重试。'); return; }
  w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>试卷 ${esc(e.code)}</title>
  <style>body{font-family:Georgia,serif;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.6;color:#1c2128}
  h1{font-size:22px}h2{font-size:18px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:28px}h3{font-size:15px;margin:18px 0 6px}
  .p{white-space:pre-wrap;background:#fafbfc;border-left:3px solid #1f5f8b;padding:10px 14px;margin:8px 0}
  ol{margin:4px 0 12px 0}li{margin:2px 0}p{margin:6px 0}</style></head><body>${h}</body></html>`);
  w.document.close();
}

/* ========================================================== ZIP 导出 == */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF; }
function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }

/* 仅存储（不压缩）的 zip，够用且无依赖 */
function makeZip(files) {
  const enc = new TextEncoder(), now = new Date();
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime(now), true); lh.setUint16(12, dosDate(now), true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime(now), true); ch.setUint16(14, dosDate(now), true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true);
  eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, offset, true); eo.setUint16(20, 0, true);
  return new Blob(locals.concat(centrals, [new Uint8Array(eo.buffer)]), { type: 'application/zip' });
}

function blobToU8(b) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(new Uint8Array(fr.result));
    fr.readAsArrayBuffer(b);
  });
}

async function exportZip() {
  const btn = $('#btn-zip'); btn.disabled = true; btn.textContent = '正在打包…';
  try {
    const e = S.exam, r = S.result, enc = new TextEncoder();
    const files = [];

    files.push({ name: '成绩报告.html', data: enc.encode(reportHTML(r)) });
    files.push({
      name: '作答数据.json', data: enc.encode(JSON.stringify({
        candidate: e.name, date: e.date, code: e.code, vocabInput: e.vocab,
        paperBand: e.band.cefr, neighborBand: e.neighbor.cefr,
        reading: r.reading, listening: r.listening,
        objectivePercent: Math.round(r.pct * 100),
        estimatedLevel: r.estBand.cefr, estimatedVocab: r.estVocab,
        detail: r.detail,
        writing: e.writing.tasks.map((t, i) => ({ prompt: t.prompt, required: t.minWords + '-' + t.maxWords, words: words(S.ans.writing[i] || ''), answer: S.ans.writing[i] || '' })),
        speaking: e.speaking.tasks.map((t, i) => ({ prompt: t.prompt, file: S.ans.speaking[i] ? S.ans.speaking[i].name : null }))
      }, null, 2))
    });

    e.writing.tasks.forEach((t, i) => {
      files.push({
        name: '写作/Task' + (i + 1) + '.txt',
        data: enc.encode('【题目】\n' + t.prompt + '\n\n【要求字数】' + t.minWords + '-' + t.maxWords +
          '\n【实际字数】' + words(S.ans.writing[i] || '') + '\n\n【作答】\n' + (S.ans.writing[i] || '（未作答）'))
      });
    });

    for (let i = 0; i < e.speaking.tasks.length; i++) {
      const a = S.ans.speaking[i];
      if (!a) continue;
      const ext = (a.name.match(/\.[a-z0-9]+$/i) || ['.webm'])[0];
      files.push({ name: '口语/Task' + (i + 1) + ext, data: await blobToU8(a.blob) });
    }

    const zip = makeZip(files);
    const fname = '英语测试_' + (e.name || '考生').replace(/[\\/:*?"<>|]/g, '') + '_' + e.date + '_' + e.code + '.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    btn.textContent = '下载结果包（含录音 .zip）';
  } catch (err) {
    alert('打包失败：' + err.message);
    btn.textContent = '下载结果包（含录音 .zip）';
  }
  btn.disabled = false;
}

function reportHTML(r) {
  const e = S.exam;
  const wSec = e.writing.tasks.map((t, i) => `<h3>Writing Task ${i + 1}（${words(S.ans.writing[i] || '')} 词 / 要求 ${t.minWords}-${t.maxWords}）</h3>
    <div class="p muted">${esc(t.prompt)}</div><div class="ans">${esc(S.ans.writing[i] || '（未作答）')}</div>`).join('');
  const sSec = e.speaking.tasks.map((t, i) => {
    const a = S.ans.speaking[i];
    return `<h3>Speaking Task ${i + 1}</h3><div class="p muted">${esc(t.prompt)}</div>
    <p>音频文件：${a ? '口语/Task' + (i + 1) + (a.name.match(/\.[a-z0-9]+$/i) || ['.webm'])[0] : '（未提交）'}</p>`;
  }).join('');
  const rev = it => it.map(d => `<p><b>${d.id}</b> ${esc(d.q)}<br>
    正确：${String.fromCharCode(65 + d.answer)}. ${esc(d.options[d.answer])}<br>
    考生：${d.got == null ? '未作答' : String.fromCharCode(65 + d.got) + '. ' + esc(d.options[d.got])} ${d.ok ? '✔' : '✘'}</p>`).join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>英语能力测试成绩报告 · ${esc(e.name || '')}</title>
<style>body{font-family:"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;max-width:820px;margin:30px auto;padding:0 24px;line-height:1.65;color:#1c2128}
h1{font-size:22px}h2{font-size:18px;border-bottom:1px solid #ddd;padding-bottom:5px;margin-top:30px}h3{font-size:15px;margin:16px 0 6px}
.box{background:#eaf2f8;border-radius:8px;padding:14px 18px;margin:14px 0}.lv{font-size:24px;font-weight:700;color:#164965}
.p{white-space:pre-wrap;background:#fafbfc;border-left:3px solid #1f5f8b;padding:10px 14px;margin:6px 0}
.ans{white-space:pre-wrap;font-family:Georgia,serif;border:1px solid #e2e6ea;border-radius:6px;padding:12px 16px;margin:6px 0}
.muted{color:#5b6570;font-size:13px}table{border-collapse:collapse;width:100%;font-size:14px;margin-top:8px}
th,td{border:1px solid #e2e6ea;padding:7px 10px;text-align:left;vertical-align:top}th{background:#f3f5f7;white-space:nowrap}
</style></head><body>
<h1>英语能力测试 · 成绩报告</h1>
<p>考生：<b>${esc(e.name || '（未署名）')}</b>　日期：${esc(e.date)}　试卷编号：${esc(e.code)}　设定词汇量：${e.vocab}　卷面档位：${esc(e.band.cefr)}</p>
<p class="muted">开始 ${esc(S.startedAt || '—')}　结束 ${esc(S.finishedAt || '—')}　用时 ${esc(durationText() || '—')}</p>
<div class="box">
  <div class="muted">客观题推算水平（不含写作口语）</div>
  <div class="lv">${esc(r.estBand.cefr)} · ${esc(r.estBand.name)}</div>
  <div>阅读 ${r.reading.correct}/${r.reading.total}　听力 ${r.listening.correct}/${r.listening.total}　合计正确率 ${Math.round(r.pct * 100)}%　对应词汇量约 ${esc(r.estVocab)} 词</div>
  <div class="muted">${esc(r.note)}</div>
</div>
<h2>写作作答（待人工评分）</h2>${wSec}
<h3>写作评分标准</h3><table>${RUBRIC_W.map(x => `<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join('')}</table>
<h2>口语作答（待人工评分）</h2>${sSec}
<h3>口语评分标准</h3><table>${RUBRIC_S.map(x => `<tr><th>${x[0]}</th><td>${x[1]}</td></tr>`).join('')}</table>
<h2>阅读逐题对照</h2>${rev(r.detail.reading)}
<h2>听力逐题对照</h2>${rev(r.detail.listening)}
<h2>听力原文</h2>${e.listening.items.map((it, i) => `<h3>Section ${i + 1} — ${esc(it.title)}</h3>` +
    it.lines.map(l => `<p><b>${l.s === 'M' ? 'MAN' : l.s === 'W' ? 'WOMAN' : 'NARRATOR'}:</b> ${esc(l.t)}</p>`).join('')).join('')}
</body></html>`;
}

/* ---------------------------------------------------------- 启动 ---- */
window.addEventListener('beforeunload', ev => {
  if (S.exam && !S.submitted && S.screen !== 'setup' && S.screen !== 'brief') {
    ev.preventDefault(); ev.returnValue = '';
  }
});

/* 带参数的考生链接：直接建卷进须知页，考生看不到出卷设置 */
function boot() {
  TTS.init();
  const p = urlParams();
  const vocab = parseInt(p.v, 10);
  if (vocab && vocab >= 100) {
    const seedText = p.code || ('LINK-' + vocab);
    S.fromLink = true;
    S.cfg = {
      name: (p.name || '').trim(), vocab, seedText, code: seedText,
      seed: hashStr(seedText + '|' + vocab),
      playLimit: parseInt(p.p, 10) || 2,
      writingCount: parseInt(p.w, 10) || 2,
      speakingCount: parseInt(p.s, 10) || 2,
      enforce: p.t !== '0',
      practice: false,
      voiceURI: ''
    };
    S.exam = buildExam(S.cfg);
    S.ans = { reading: {}, listening: {}, writing: [], speaking: [] };
    S.plays = {};
    TTS.init(() => { if (!TTS.voice) TTS.voice = TTS.pickDefault(); });
    go('brief');
    return;
  }
  renderSetup();
}
boot();
