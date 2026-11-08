/* =========================================================================
   英语能力测试 · 通知通道（考试页 index.html 与词汇量测试页 vocab.html 共用）
   从 app.js 拆出来，两个页面走同一套 webhook / 中转逻辑，配置只认 config.js。
   纯全局脚本，必须在 config.js 之后、app.js / vocab.js 之前加载。
   ========================================================================= */
'use strict';

/* ------------------------------------------------------ 邮件通道 ---- */
/* 四种运行环境：
   gas     —— 页面由 Google Apps Script 托管，用内部通道调用，有成功/失败回执
   webhook —— 填了 WEBHOOK_URL：企业微信 / 飞书群机器人
   http    —— 页面在别的静态空间，跨域 POST 到 /exec，只能发出去、拿不到回执
   none    —— 没配置，考试照常进行，结果页给出提醒和补发按钮 */
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
    const roundTxt = d.round ? '（第 ' + d.round + ' 轮）' : '';
    if (d.kind === 'start') {
      return ['【' + kw + '】开考',
        '考生：' + d.name,
        '开始时间：' + d.startedAt + (d.tz ? '（' + d.tz + '）' : ''),
        '词汇量 ' + d.vocab + ' → ' + d.band + ' 卷（微调档 ' + d.neighbor + '）',
        '试卷编号：' + d.code + roundTxt,
        '构成：' + d.paper].join('\n');
    }
    if (d.kind === 'finish') {
      const head = ['【' + kw + '】交卷',
        '考生：' + d.name + '　编号 ' + d.code + roundTxt,
        '用时 ' + (d.duration || '—') + '（' + d.startedAt + ' → ' + d.finishedAt + '）',
        '阅读 ' + d.reading.correct + '/' + d.reading.total +
        '　听力 ' + d.listening.correct + '/' + d.listening.total +
        '　正确率 ' + d.percent + '%',
        '推算水平：' + d.estLevel + '（约 ' + d.estVocab + ' 词）',
        d.note || ''].concat(d.scoreCode ? ['成绩码：' + d.scoreCode] : []).join('\n');
      const writing = (d.writing || []).map(w =>
        '\n—— 写作 Task ' + w.task + '（' + w.words + ' 词 / 要求 ' + w.required + '）——\n' + w.text).join('\n');
      const spk = (d.speaking || []);
      const done = spk.filter(s => s.file).length;
      const tail = '\n—— 口语 ——\n' + (done
        ? done + ' 题已录音。群机器人发不了音频，请考生把结果包（zip）发给考官。'
        : '未提交音频。');
      return head + '\n' + writing + tail;
    }
    if (d.kind === 'vocab') {
      return ['【' + kw + '】词汇量测试',
        '考生：' + d.name + '　编号 ' + d.code,
        '日期：' + d.date + '　用时 ' + (d.duration || '—'),
        '估计词汇量：约 ' + d.estimate + ' 词（建议档位 ' + d.cefr + '）',
        '各档已掌握（每档 10 词，已做猜测校正）：',
        d.bands.map(b => b.label + ' ' + b.known).join('　'),
        '成绩码：' + d.scoreCode].join('\n');
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

/* 一键复制（成绩码用）：file:// 或旧浏览器没有 clipboard API 时退回 execCommand */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    return navigator.clipboard.writeText(text).then(() => true, () => copyFallback(text));
  }
  return Promise.resolve(copyFallback(text));
}
function copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { }
  ta.remove();
  return ok;
}
