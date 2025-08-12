import 'dotenv/config';
import fs from 'node:fs';
import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GAS_URL = process.env.GAS_URL;
const GAS_TOKEN = process.env.GAS_TOKEN;
const JUDGE_MODEL = 'gemini-2.5-pro';
const MAX_CHARS_PER_ANSWER = Number(process.env.MAX_CHARS_PER_ANSWER || 4000);
const FORCE_REEVAL = String(process.env.FORCE_REEVAL||'').toLowerCase()==='true';

const DEFAULT_WEIGHTS = { accuracy:35, completeness:20, evidence:20, actionability:15, clarity:10, safety:0 };
const WEIGHTS = (()=>{ try{ return JSON.parse(process.env.WEIGHTS_JSON||'{}'); }catch{ return {}; } })();
const MERGED_WEIGHTS = { ...DEFAULT_WEIGHTS, ...WEIGHTS };

function normWeights(w){ const t=Object.values(w).reduce((a,b)=>a+Number(b||0),0)||1; const o={}; for(const k in w) o[k]=Number(w[k])/t; return o; }
const WN = normWeights(MERGED_WEIGHTS);

async function gasGet(params){
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const r = await fetch(url, { method:'GET' });
  if(!r.ok) throw new Error('GAS GET '+r.status);
  return await r.json();
}
async function gasPost(body){
  const r = await fetch(GAS_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(body) });
  if(!r.ok) throw new Error('GAS POST '+r.status);
  return await r.json();
}

function truncate(s){ if(!s) return s; return String(s).length>MAX_CHARS_PER_ANSWER ? (String(s).slice(0,MAX_CHARS_PER_ANSWER)+'\n\n[...trimmed for judging...]') : s; }

function buildPrompt(question, items){
  const crit=[
    ['accuracy','정확성','사실·수치·논리 정확'],
    ['completeness','완결성','요청 하위항목 충족'],
    ['evidence','근거성','출처·근거 및 정합성'],
    ['actionability','실행가능성','구체 절차·리스크·대안'],
    ['clarity','명료성','구조·표현 명확'],
    ['safety','안전','정책 위반 없음']
  ];
  const wtxt = crit.map(([k,l,d])=>`- ${l}(${k}): ${(WN[k]*100).toFixed(1)}% — ${d}`).join('\n');
  const answers = items.map((it,i)=>`### 응답 ${i+1} — "${it.model}"
${truncate(it.answer_text)}`).join('\n\n');
  return `당신은 공정한 심사위원이다. 동일한 질문과 여러 모델의 한국어 응답을 \n정량 루브릭으로 평가하고 **JSON**만 출력하라.

## 질문
${question}

## 응답들
${answers}

## 평가 기준과 가중치
${wtxt}
- 각 기준은 0~5점(소수 허용)으로 채점하고, 가중합으로 총점(0~100)을 계산한다.
- 불필요한 장문/레토릭에는 가점을 주지 않는다.
- 타이 발생 시 더 정확/근거/구체한 응답을 우선한다.

## 출력(JSON only)
{
  "criteria_scores": { "<모델명>": { "accuracy": number, "completeness": number, "evidence": number, "actionability": number, "clarity": number, "safety": number } },
  "total_scores": { "<모델명>": number },
  "ranking": ["<1위 모델명>", "<2위 모델명>", ...],
  "reasons": { "<모델명>": "간단한 근거" }
}`;
}

async function fetchWithBackoff(url, init, tries=5){
  let last; for(let i=0;i<tries;i++){
    const r = await fetch(url, init);
    if(r.ok) return r; last = r; const st=r.status;
    if(st===429||st===503){ await new Promise(res=>setTimeout(res, (i+1)*1000)); continue; }
    break;
  }
  if(last) throw new Error('Gemini API '+last.status+' '+(await last.text()));
  throw new Error('Gemini API unreachable');
}

async function callGeminiJudge(question, items){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(JUDGE_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    contents: [{ role:'user', parts:[{ text: buildPrompt(question, items) }] }],
    generationConfig: { temperature:0.2, topP:0.9, maxOutputTokens:2048, responseMimeType:'application/json' }
  };
  const r = await fetchWithBackoff(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error('No JSON from Gemini');
  const cleaned = text.replace(/^```json\n?|```$/g,'');
  return JSON.parse(cleaned);
}

function groupByQuestion(rawRows){
  const byQ = new Map();
  for(const r of rawRows){
    const qid=String(r.question_id);
    if(!byQ.has(qid)) byQ.set(qid,{ question_id:qid, question:r.question, items:[] });
    byQ.get(qid).items.push({ model:r.model, answer_text:r.answer_text });
  }
  return [...byQ.values()];
}

function existingScoreSet(scoreRows){
  const s=new Set(); scoreRows.forEach(r=>s.add(`${r.question_id}@@${r.model}`)); return s;
}

function toScoreRows(q, judged){
  const out=[]; const cs=judged.criteria_scores||{}; const totals=judged.total_scores||{}; const reasons=judged.reasons||{};
  q.items.forEach(it=>{
    const c=cs[it.model]||{}; const tot=Number(totals[it.model]||0);
    out.push({ question_id:q.question_id, model:it.model,
      accuracy:Number(c.accuracy||0), completeness:Number(c.completeness||0), evidence:Number(c.evidence||0),
      actionability:Number(c.actionability||0), clarity:Number(c.clarity||0), safety:Number(c.safety||0),
      total: Number(tot.toFixed ? tot.toFixed(2) : tot), reason: reasons[it.model]||'', judge_model:JUDGE_MODEL, judged_at:new Date().toISOString() });
  });
  return out;
}

async function main(){
  if(!GEMINI_API_KEY||!GAS_URL||!GAS_TOKEN) throw new Error('Missing envs');
  const raw = (await gasGet({ action:'getRows', sheet:'raw' })).rows||[];
  const scored = (await gasGet({ action:'getRows', sheet:'scores' })).rows||[];
  const done = existingScoreSet(scored);
  const groups = groupByQuestion(raw).filter(g=> FORCE_REEVAL || g.items.some(it=> !done.has(`${g.question_id}@@${it.model}`)) );
  console.log('pending groups:', groups.length);

  for(const g of groups){
    try{
      // 전체 항목을 넣어 일관된 상대평가 맥락 유지(이미 채점된 것도 함께 넣되, 저장은 미채점 대상만)
      const judged = await callGeminiJudge(g.question, g.items);
      let rows = toScoreRows(g, judged);
      if(!FORCE_REEVAL) rows = rows.filter(r=> !done.has(`${r.question_id}@@${r.model}`));
      if(rows.length){ await gasPost({ action:'appendScores', token:GAS_TOKEN, rows }); }
      console.log('judged:', g.question_id, rows.length);
    }catch(err){ console.error('judge fail', g.question_id, err.message); }
  }

  const summary = await gasGet({ action:'getSummary' });
  fs.mkdirSync('site', { recursive:true });
  fs.writeFileSync('site/summary.json', JSON.stringify(summary, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); });
