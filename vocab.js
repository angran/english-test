/* =========================================================================
   词汇量测试 · 页面逻辑（vocab.html）
   - 方法：看英文词选中文意思（释义识别），比「认识 / 不认识」自报更老实
   - 10 个频率档（1k…10k），每档按种子抽 10 词，共 100 题；同一测试编号 = 同一份题
   - 每题另有「不认识」选项；计分做猜测校正：已掌握 = 答对 − 答错/3（不含选「不认识」的）
   - 估计词汇量 = Σ(各档已掌握/10 × 1000)，取整到 50
   - 交卷后通过 notify.js 的 MAIL 推送给考官（未配置则静默跳过）
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------- 小工具 ---- */
/* 与 app.js 同款（这一页不加载 app.js）：同样的 hash + mulberry32，保证确定性出题 */
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
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowStamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function urlParams() {
  const p = {};
  new URLSearchParams(location.search).forEach((v, k) => p[k] = v);
  return p;
}
/* 成绩码字段里不能有 | 和换行 */
function codeField(x) { return String(x == null ? '' : x).replace(/[|\r\n]+/g, '/').trim(); }
/* 9.666… → "9.7"，10 → "10" */
function fmt1(x) { return String(Math.round(x * 10) / 10); }

/* ---------------------------------------------------------- 常量 ---- */
const PER_BAND = 10;
const IDK = 4;                  // 选项下标 0–3 是释义，4 是「不认识」
/* 与综合测试题库（bank/a2.js … c2.js 的 min/max）同一套档位划分 */
const CEFR_BANDS = [
  { cefr: 'A2', name: '基础', max: 2000 },
  { cefr: 'B1', name: '中级', max: 3500 },
  { cefr: 'B2', name: '中高级', max: 6000 },
  { cefr: 'C1', name: '高级', max: 9000 },
  { cefr: 'C2', name: '精通', max: Infinity }
];
function cefrFor(v) { return CEFR_BANDS.find(b => v <= b.max); }

/* ---------------------------------------------------------- 状态 ---- */
const V = {
  cfg: null,        // { name, code, codeTyped }
  items: null,      // [{ band, w, m, options[4], answer }]
  ans: [],          // 每题所选下标 0–4
  idx: 0,
  startedAt: null, finishedAt: null,
  done: false, result: null, mail: null
};

function saveKey(code) { return 'eet:vocab:' + code; }
function persist() {
  if (!V.cfg) return;
  try {
    localStorage.setItem(saveKey(V.cfg.code), JSON.stringify({
      cfg: V.cfg, ans: V.ans, idx: V.idx, startedAt: V.startedAt, finishedAt: V.finishedAt, done: V.done, mail: V.mail
    }));
    localStorage.setItem('eet:vocab:last', V.cfg.code);
  } catch (e) { /* 存储满或隐私模式，忽略 */ }
}
function loadSaved(code) {
  try { const raw = localStorage.getItem(saveKey(code)); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

/* ---------------------------------------------------------- 出题 ---- */
/* 种子只看测试编号：同一编号永远是同一份 100 题、同样的选项顺序 */
function buildTest(code) {
  const rnd = mulberry32(hashStr(code + '|vocab'));
  const items = [];
  VOCAB_BANK.bands.forEach((b, bi) => {
    pickSeeded(b.words, PER_BAND, rnd).forEach(x => {
      const opts = [x.m].concat(x.d);
      const idx = [0, 1, 2, 3];
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
      }
      items.push({ band: bi, w: x.w, m: x.m, options: idx.map(i => opts[i]), answer: idx.indexOf(0) });
    });
  });
  return items;
}

/* ---------------------------------------------------------- 计分 ---- */
function grade() {
  const bands = VOCAB_BANK.bands.map(b => ({ id: b.id, correct: 0, wrong: 0, idk: 0, blank: 0, total: 0 }));
  V.items.forEach((it, i) => {
    const b = bands[it.band], a = V.ans[i];
    b.total++;
    if (a == null) b.blank++;
    else if (a === IDK) b.idk++;
    else if (a === it.answer) b.correct++;
    else b.wrong++;
  });
  let sum = 0;
  bands.forEach(b => {
    /* 猜测校正：四选一瞎蒙的期望是对 1 错 3，所以每 3 个错答抵消 1 个对答 */
    b.known = Math.max(0, b.correct - b.wrong / 3);
    sum += b.known / PER_BAND * 1000;
  });
  const estimate = Math.round(sum / 50) * 50;
  return { bands, estimate, band: cefrFor(estimate) };
}

function durationText() {
  if (!V.startedAt || !V.finishedAt) return '';
  const ms = new Date(V.finishedAt.replace(/-/g, '/')) - new Date(V.startedAt.replace(/-/g, '/'));
  if (!(ms > 0)) return '';
  if (ms < 60000) return Math.round(ms / 1000) + ' 秒';
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟' : m + ' 分钟';
}

function scoreCode() {
  const r = V.result;
  return ['VOCAB', codeField(V.cfg.name), codeField(V.cfg.code), (V.finishedAt || nowStamp()).slice(0, 10),
    r.estimate, r.bands.map(b => fmt1(b.known)).join(',')].join('|');
}

/* ---------------------------------------------------------- 通知 ---- */
async function notifyResult() {
  const r = V.result;
  const payload = {
    kind: 'vocab',
    name: V.cfg.name, code: V.cfg.code,
    date: (V.finishedAt || nowStamp()).slice(0, 10),
    startedAt: V.startedAt, finishedAt: V.finishedAt,
    duration: durationText(),
    estimate: r.estimate,
    cefr: r.band.cefr + ' · ' + r.band.name,
    bands: r.bands.map(b => ({ label: b.id, known: fmt1(b.known), correct: b.correct, wrong: b.wrong, idk: b.idk })),
    scoreCode: scoreCode()
  };
  let res;
  try { res = await MAIL.sendTimeout(payload, 15000); }
  catch (e) { res = { ok: false, mode: MAIL.mode(), detail: e.message }; }
  V.mail = res; persist();
  return res;
}

/* ---------------------------------------------------------- 页面 ---- */
function setMeta() {
  const m = $('#topmeta');
  m.innerHTML = V.cfg ? esc(V.cfg.name) + '<br><span style="opacity:.7">编号 ' + esc(V.cfg.code) + '</span>' : '';
}

function renderSetup() {
  V.cfg = null; setMeta();
  const pre = urlParams();
  const last = (() => { try { return localStorage.getItem('eet:vocab:last'); } catch (e) { return null; } })();
  const saved = last ? loadSaved(last) : null;
  const resumable = saved && saved.cfg && !saved.done;
  const mailOn = MAIL.mode() !== 'none';

  APP.innerHTML = `
  <div class="card">
    <h1>词汇量测试</h1>
    <p class="lead">共 100 个英文单词，从最常用的词逐步到很少见的词（1000 词档 → 10000 词档，每档 10 个）。
      每题选出这个词的中文意思。做完给出估计词汇量和建议档位，可以直接带去做综合测试。</p>

    ${resumable ? `<div class="notice">检测到一次未完成的测试：<b>${esc(saved.cfg.name)}</b>（编号 ${esc(saved.cfg.code)}，已答 ${(saved.ans || []).filter(a => a != null).length} / 100）。
      <button class="ghost small" id="btn-resume" style="margin-left:8px">继续作答</button>
      <button class="ghost small" id="btn-drop">丢弃</button></div>` : ''}
    ${saved && saved.cfg && saved.done ? `<div class="notice small">本机上次的结果：<b>${esc(saved.cfg.name)}</b>（编号 ${esc(saved.cfg.code)}，${esc((saved.finishedAt || '').slice(0, 10))}）。
      <button class="ghost small" id="btn-last" style="margin-left:8px">查看上次结果</button></div>` : ''}

    <div class="row">
      <div class="field">
        <label for="f-name">姓名</label>
        <input type="text" id="f-name" placeholder="例：Wang Lei" value="${esc(pre.name || '')}">
      </div>
      <div class="field">
        <label for="f-code">测试编号（留空自动生成）</label>
        <input type="text" id="f-code" placeholder="例：2026-10" value="${esc(pre.code || '')}">
        <div class="hint">相同编号 = 完全相同的 100 题。每月复测建议换个编号（如 2026-11），抽到的词会不同。</div>
      </div>
    </div>

    <h3>作答说明</h3>
    <ul class="small">
      <li><b>不认识就选「不认识」</b>。乱猜答错会扣分（每答错 3 题抵消 1 题答对），选「不认识」不扣分——老实作答结果才准。</li>
      <li>不限时，但请一口气做完，别查词典。大约需要 10–15 分钟。</li>
      <li>点选项后自动进入下一题；点错了可以按「上一题」回去改。电脑上也可以按键盘 1–4 选释义、5 选「不认识」。</li>
      ${mailOn ? '<li>点击「开始」即表示你同意：你的<b>姓名和测试结果</b>将发送给考官。</li>' : ''}
    </ul>

    <div class="actions">
      <button class="primary" id="btn-go">开始测试</button>
      <a class="small" href="index.html">返回综合测试</a>
      <span class="spacer"></span>
      <span class="small muted">结果通知：${MAIL.modeText()}</span>
    </div>
  </div>`;

  $('#btn-go').onclick = () => {
    const name = $('#f-name').value.trim();
    if (!name) { alert('请先填写姓名。'); $('#f-name').focus(); return; }
    let code = $('#f-code').value.trim();
    const codeTyped = !!code;
    if (!code) code = todayStr().replace(/-/g, '').slice(4) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    const old = loadSaved(code);
    if (old && old.done && !confirm('编号「' + code + '」已经做过一次（同编号题目完全相同）。确定要用同一编号重做吗？')) return;
    V.cfg = { name, code, codeTyped };
    V.items = buildTest(code);
    V.ans = []; V.idx = 0; V.done = false; V.result = null; V.mail = null;
    V.startedAt = nowStamp(); V.finishedAt = null;
    persist();
    renderItem();
  };

  if ($('#btn-last')) $('#btn-last').onclick = () => showSaved(saved);
  if (resumable) {
    $('#btn-resume').onclick = () => {
      V.cfg = saved.cfg;
      V.items = buildTest(V.cfg.code);
      V.ans = saved.ans || []; V.idx = Math.min(saved.idx || 0, V.items.length - 1);
      V.startedAt = saved.startedAt || nowStamp(); V.finishedAt = null; V.done = false; V.mail = null;
      renderItem();
    };
    $('#btn-drop').onclick = () => {
      try { localStorage.removeItem(saveKey(saved.cfg.code)); localStorage.removeItem('eet:vocab:last'); } catch (e) { }
      renderSetup();
    };
  }
}

function renderItem() {
  setMeta();
  const i = V.idx, it = V.items[i], n = V.items.length;
  const answered = V.ans.filter(a => a != null).length;
  const chosen = V.ans[i];
  const labels = it.options.concat(['不认识']);
  APP.innerHTML = `
  <div class="card">
    <div class="small muted">第 ${i + 1} / ${n} 题 · 已答 ${answered} 题</div>
    <div class="vprog"><i style="width:${Math.round(answered / n * 100)}%"></i></div>
    <div class="vword" lang="en">${esc(it.w)}</div>
    <div class="vopts">
      ${labels.map((o, k) => `<label class="opt${k === IDK ? ' idk' : ''}${chosen === k ? ' sel' : ''}" data-k="${k}">
        <input type="radio" name="v" value="${k}"${chosen === k ? ' checked' : ''}>${k === IDK ? '' : (k + 1) + '. '}${esc(o)}</label>`).join('')}
    </div>
    <div class="actions">
      <button class="ghost" id="btn-prev"${i === 0 ? ' disabled' : ''}>上一题</button>
      <span class="spacer"></span>
      ${i < n - 1
      ? `<button class="ghost" id="btn-next"${chosen == null ? ' disabled' : ''}>下一题</button>`
      : `<button class="primary" id="btn-finish">交卷</button>`}
    </div>
  </div>`;

  $$('.vopts .opt').forEach(opt => {
    opt.onclick = ev => { ev.preventDefault(); choose(parseInt(opt.dataset.k, 10)); };
  });
  $('#btn-prev').onclick = () => { if (V.idx > 0) { V.idx--; persist(); renderItem(); } };
  if ($('#btn-next')) $('#btn-next').onclick = () => { V.idx++; persist(); renderItem(); };
  if ($('#btn-finish')) $('#btn-finish').onclick = finish;
}

let advancing = null;
function choose(k) {
  if (V.done || !V.items) return;
  clearTimeout(advancing);
  V.ans[V.idx] = k; persist();
  $$('.vopts .opt').forEach(o => o.classList.toggle('sel', parseInt(o.dataset.k, 10) === k));
  const nb = $('#btn-next'); if (nb) nb.disabled = false;
  /* 稍停一下让考生看到选中效果，再进入下一题；最后一题停住等交卷 */
  if (V.idx < V.items.length - 1) {
    const at = V.idx;
    advancing = setTimeout(() => { if (V.idx === at && !V.done) { V.idx++; persist(); renderItem(); } }, 220);
  }
}

/* 键盘：1–4 选释义，5 / 0 选「不认识」，← 上一题 */
document.addEventListener('keydown', ev => {
  if (!V.items || V.done || !$('.vopts')) return;
  if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
  if (ev.key >= '1' && ev.key <= '4') choose(parseInt(ev.key, 10) - 1);
  else if (ev.key === '5' || ev.key === '0') choose(IDK);
  else if (ev.key === 'ArrowLeft' && V.idx > 0) { clearTimeout(advancing); V.idx--; persist(); renderItem(); }
});

async function finish() {
  const left = V.items.length - V.ans.filter(a => a != null).length;
  if (left > 0) {
    if (!confirm('还有 ' + left + ' 题没作答，未答的题按「不认识」处理。确定交卷吗？')) return;
  } else if (!confirm('确定交卷吗？交卷后不能再修改。')) return;
  clearTimeout(advancing);
  V.done = true;
  V.finishedAt = nowStamp();
  V.result = grade();
  persist();
  const btn = $('#btn-finish');
  if (btn) { btn.disabled = true; btn.textContent = MAIL.mode() === 'none' ? '正在计分…' : '正在发送结果…'; }
  await notifyResult();
  renderResult();
}

function mailLine() {
  const r = V.mail;
  if (!r || r.mode === 'none') return '<span class="muted">未配置通知，结果不会自动发给考官——请把下面的成绩码复制发给考官。</span>';
  if (r.ok && r.mode === 'webhook') return '<span class="tick">✔ 已推送到考官群</span> <span class="muted small">（浏览器读不到对方响应，无法确认对方是否收到）</span>';
  if (r.ok) return '<span class="tick">✔ 已发送给考官</span>';
  return '<span class="cross">✘ 发送失败</span> <span class="muted small">' + esc(r.detail || '') + '</span> <button class="ghost small" id="btn-resend">重新发送</button>';
}

function renderResult() {
  setMeta();
  const r = V.result, code = scoreCode();
  const back = new URLSearchParams({ vocab: String(r.estimate), name: V.cfg.name });
  if (V.cfg.codeTyped) back.set('code', V.cfg.code);
  const bars = r.bands.map(b => {
    const pct = Math.round(b.known / PER_BAND * 100);
    const cls = b.known >= 7 ? '' : b.known >= 4 ? ' mid' : ' low';
    return `<div class="vbar"><span>${esc(b.id)}</span>
      <div class="track"><div class="fill${cls}" style="width:${pct}%"></div></div>
      <span class="num">${fmt1(b.known)} / ${PER_BAND}</span></div>`;
  }).join('');
  const rows = V.items.map((it, i) => {
    const a = V.ans[i];
    const got = a == null ? '（未答）' : a === IDK ? '不认识' : it.options[a];
    const mark = a === it.answer ? '<span class="tick">✔</span>' : (a == null || a === IDK) ? '<span class="muted">—</span>' : '<span class="cross">✘</span>';
    return `<tr><td>${esc(VOCAB_BANK.bands[it.band].id)}</td><td lang="en"><b>${esc(it.w)}</b></td><td>${esc(it.m)}</td><td>${esc(got)} ${mark}</td></tr>`;
  }).join('');

  APP.innerHTML = `
  <div class="card">
    <h1>词汇量测试结果</h1>
    <p class="lead">${esc(V.cfg.name)} · 编号 ${esc(V.cfg.code)} · ${esc((V.finishedAt || '').slice(0, 10))} · 用时 ${esc(durationText() || '—')}</p>
    <div class="levelbox">
      <div class="small muted">估计词汇量（已做猜测校正）</div>
      <div class="lv">约 ${r.estimate} 词</div>
      <div class="small">建议档位：<b>${esc(r.band.cefr)} · ${esc(r.band.name)}</b>（A2 ≤2000 / B1 2001–3500 / B2 3501–6000 / C1 6001–9000 / C2 ≥9001）</div>
    </div>
    <h3>各频率档掌握情况</h3>
    <div class="small muted">每档 10 词；已掌握 = 答对 − 答错/3，选「不认识」不扣分。</div>
    <div class="vbars">${bars}</div>
    <div class="scorecode">
      <span class="small muted">成绩码</span>
      <code id="score-code">${esc(code)}</code>
      <button class="ghost small" id="btn-copycode">复制</button>
      <span class="small tick hidden" id="copy-ok">✔ 已复制</span>
    </div>
    <div class="notice small"><b>结果通知</b>　${mailLine()}</div>
    <div class="actions">
      <button class="primary" id="btn-exam">用这个词汇量去做综合测试</button>
      <button class="ghost" id="btn-print">打印本页</button>
      <button class="ghost" id="btn-again">再测一次</button>
    </div>
  </div>
  <div class="card">
    <details>
      <summary style="cursor:pointer;font-weight:600;font-size:17px">逐词对照（可用来查漏补缺）</summary>
      <table class="rubric"><tr><th>档</th><th>单词</th><th>意思</th><th>你的选择</th></tr>${rows}</table>
    </details>
  </div>`;

  $('#btn-copycode').onclick = () => copyText(code).then(ok => {
    const t = $('#copy-ok');
    t.textContent = ok ? '✔ 已复制' : '复制失败，请手动选中复制';
    t.classList.remove('hidden');
  });
  $('#btn-exam').onclick = () => { location.href = 'index.html?' + back.toString(); };
  $('#btn-print').onclick = () => window.print();
  $('#btn-again').onclick = () => {
    if (!confirm('回到开始页面重新测一次？（本次结果仍保存在本机，同编号可再次查看）')) return;
    V.items = null; V.done = false; renderSetup();
  };
  if ($('#btn-resend')) $('#btn-resend').onclick = async () => {
    const b = $('#btn-resend'); b.disabled = true; b.textContent = '正在发送…';
    await notifyResult();
    renderResult();
  };
}

/* ---------------------------------------------------------- 启动 ---- */
/* 上次交过卷的结果留在本机：开始页给「查看上次结果」按钮（同一台电脑可能两个人轮流测，所以不自动跳结果页） */
function showSaved(saved) {
  V.cfg = saved.cfg;
  V.items = buildTest(V.cfg.code);
  V.ans = saved.ans || []; V.idx = saved.idx || 0;
  V.startedAt = saved.startedAt; V.finishedAt = saved.finishedAt;
  V.done = true; V.mail = saved.mail || null;
  V.result = grade();
  renderResult();
}
renderSetup();
