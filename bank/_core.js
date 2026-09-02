/* ============================================================
   英语能力测试 · 题库核心
   五个档位：A2 / B1 / B2 / C1 / C2，每档一个文件，依次 push 进来。
   纯全局变量，不用 ES module / fetch —— 保证 file:// 双击也能跑。
   ============================================================ */
var EXAM_BANK = { bands: [] };

/* 每个档位的数据结构
   {
     id, cefr, name, min, max,      // min/max = 该档覆盖的词汇量区间
     rate,                          // 听力朗读语速 (SpeechSynthesis rate)
     vocabHint,
     reading:   [ { title, text, questions:[{q, options[4], answer}] × 5 } ],
     listening: [ { title, lines:[{s:'M'|'W'|'N', t}], questions:[{...}] × 2 } ],
     writing:   [ { type:'short'|'essay', minutes, minWords, maxWords, prompt } ],
     speaking:  [ { prepSec, speakSec, prompt } ]
   }
   s: M = 男声, W = 女声, N = 旁白/播报
*/
