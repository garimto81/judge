import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18';
import { createRoot } from 'https://esm.sh/react-dom@18/client';

const GAS_URL = window.GAS_URL || '';

async function fetchSummary() {
  try{ const r=await fetch('summary.json', { cache:'no-cache' }); if(r.ok) return await r.json(); }catch{}
  if(GAS_URL){ const r2=await fetch(GAS_URL+'?action=getSummary'); if(r2.ok) return await r2.json(); }
  return { ok:false, models:[], questions:[], generated_at:null };
}

function Chip({children}){ return <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs">{children}</span>; }
function ScoreBar({value}){ const v=Math.max(0,Math.min(100,Number(value||0))); return <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-slate-900" style={{width:`${v}%`}}/></div>; }

function UploadPanel(){
  const [rows,setRows]=useState([]); const [info,setInfo]=useState('question_id,question,model,answer_text 컬럼을 가진 CSV/JSON 업로드');
  const [gasUrl,setGasUrl]=useState(''); const [token,setToken]=useState(''); const [loading,setLoading]=useState(false);
  function onFile(e){
    const f=e.target.files?.[0]; if(!f) return; const name=f.name.toLowerCase(); const rd=new FileReader();
    rd.onload=()=>{ try{
      if(name.endsWith('.json')){ const data=JSON.parse(rd.result); const arr=Array.isArray(data)?data:(data.rows||[]); setRows(arr); setInfo(`${arr.length} rows from JSON`); }
      else{ Papa.parse(rd.result, { header:true, skipEmptyLines:true, complete:res=>{ setRows(res.data); setInfo(`${res.data.length} rows from CSV`); } }); }
    }catch(err){ setInfo('파싱 실패: '+err.message); } };
    rd.readAsText(f);
  }
  async function onSend(){
    if(!gasUrl||!token) return alert('GAS URL/TOKEN 입력'); if(!rows.length) return alert('업로드할 행이 없습니다'); setLoading(true);
    try{ const withTs=rows.map(r=>({ ...r, created_at:r.created_at||new Date().toISOString() }));
      const r=await fetch(gasUrl,{ method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify({ action:'appendRows', sheet:'raw', token, rows:withTs }) });
      const j=await r.json(); if(!j.ok) throw new Error(j.error||'업로드 실패'); alert(`업로드 완료: ${j.inserted}건`);
    }catch(err){ alert(err.message); } setLoading(false);
  }
  return (
    <section className="bg-white rounded-2xl shadow p-4 space-y-3">
      <h2 className="text-lg font-semibold">데이터 업로드</h2>
      <p className="text-sm text-slate-600">{info}</p>
      <input type="file" accept=".csv,.json" onChange={onFile} className="block" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input className="rounded-lg border p-2" placeholder="Apps Script Web App URL" value={gasUrl} onChange={e=>setGasUrl(e.target.value)} />
        <input className="rounded-lg border p-2" placeholder="TOKEN" value={token} onChange={e=>setToken(e.target.value)} />
        <button onClick={onSend} disabled={loading} className={`rounded-lg text-white p-2 ${loading?'bg-slate-400':'bg-slate-900 hover:bg-slate-800'}`}>{loading?'업로드 중…':'시트에 업로드'}</button>
      </div>
      <p className="text-xs text-slate-500">* 업로드 후 평가는 GitHub Actions가 주기적으로 실행합니다(기본 15분). 즉시 반영은 Actions 수동 실행.</p>
    </section>
  );
}

function Leaderboard({models}){
  const sorted=[...models].sort((a,b)=>b.mean_total-a.mean_total);
  return (
    <section className="bg-white rounded-2xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">모델별 평균 점수</h2>
        <div className="text-xs text-slate-500">모델 수: {sorted.length}</div>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map(m=> (
          <div key={m.model} className="border rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{m.model}</span>
              <Chip>{m.n}개 문항</Chip>
            </div>
            <div className="text-2xl font-bold mb-2">{(m.mean_total||0).toFixed(1)}<span className="text-sm text-slate-500"> /100</span></div>
            <ScoreBar value={m.mean_total} />
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
              <div>정확 {(m.mean_accuracy||0).toFixed(2)}</div>
              <div>완결 {(m.mean_completeness||0).toFixed(2)}</div>
              <div>근거 {(m.mean_evidence||0).toFixed(2)}</div>
              <div>실행 {(m.mean_actionability||0).toFixed(2)}</div>
              <div>명료 {(m.mean_clarity||0).toFixed(2)}</div>
              <div>안전 {(m.mean_safety||0).toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuestionCard({q, openAll}){
  const [open, setOpen]=useState(false);
  useEffect(()=>{ setOpen(openAll); },[openAll]);
  const ranked=(q.entries||[]).filter(e=>e.score).sort((a,b)=>b.score.total-a.score.total);
  const [modelFilter, setModelFilter] = useState('');
  const shown = useMemo(()=> ranked.filter(e=> !modelFilter || e.model===modelFilter ), [ranked, modelFilter]);
  const top=(ranked[0]?.model)||null;
  return (
    <div className="border rounded-2xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">#{q.question_id}</div>
          <h3 className="font-semibold">{q.question}</h3>
          {q.ranking?.length>0 && <div className="mt-1 text-xs text-slate-600">순위: {q.ranking.join(' > ')} {top && <Chip>1위 {top}</Chip>}</div>}
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-md border text-sm" value={modelFilter} onChange={e=>setModelFilter(e.target.value)}>
            <option value="">전체</option>
            {ranked.map(e=> <option key={e.model} value={e.model}>{e.model}</option>)}
          </select>
          <button className="px-3 py-1.5 rounded-lg text-white bg-slate-900 hover:bg-slate-800" onClick={()=>setOpen(!open)}>{open?'접기':'펼치기'}</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          {shown.map(e=> (
            <div key={e.model} className="border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{e.model}</div>
                <Chip>{(e.score.total||0).toFixed(1)} /100</Chip>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                <div>정확 {e.score.accuracy.toFixed(2)}</div>
                <div>완결 {e.score.completeness.toFixed(2)}</div>
                <div>근거 {e.score.evidence.toFixed(2)}</div>
                <div>실행 {e.score.actionability.toFixed(2)}</div>
                <div>명료 {e.score.clarity.toFixed(2)}</div>
                <div>안전 {e.score.safety.toFixed(2)}</div>
              </div>
              {e.score.reason && <div className="mt-2 text-xs text-slate-700">근거: {e.score.reason}</div>}
              <details className="mt-3 group">
                <summary className="cursor-pointer select-none text-sm text-slate-700 group-open:font-semibold">답변 펼치기</summary>
                <pre className="mt-2 p-2 bg-slate-50 rounded-lg text-xs whitespace-pre-wrap leading-5">{e.answer_text}</pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function App(){
  const [data,setData]=useState({ models:[], questions:[], generated_at:null });
  const [loading,setLoading]=useState(true);
  const [qFilter,setQFilter]=useState('');
  const [openAll,setOpenAll]=useState(false);

  useEffect(()=>{ (async()=>{ setLoading(true); setData(await fetchSummary()); setLoading(false); })(); },[]);

  const questions = useMemo(()=>{
    const qs=data.questions||[]; if(!qFilter.trim()) return qs; const f=qFilter.toLowerCase();
    return qs.filter(q=> String(q.question).toLowerCase().includes(f) || String(q.question_id).includes(f));
  },[data,qFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 답변 심사 리더보드 <span className="text-sm text-slate-500">(Gemini 2.5 Pro)</span></h1>
          {data.generated_at && <div className="text-xs text-slate-500">업데이트: {new Date(data.generated_at).toLocaleString()}</div>}
        </div>
        <div className="flex items-center gap-2">
          <input className="rounded-lg border p-2 text-sm" placeholder="질문 검색…" value={qFilter} onChange={e=>setQFilter(e.target.value)} />
          <button className="px-3 py-1.5 rounded-lg text-white bg-slate-900 hover:bg-slate-800" onClick={()=>setOpenAll(v=>!v)}>{openAll? '모두 접기':'모두 펼치기'}</button>
        </div>
      </header>

      <Leaderboard models={data.models||[]} />
      <UploadPanel />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">질문별 상세</h2>
        {loading && <div className="text-slate-500">불러오는 중…</div>}
        {!loading && questions.length===0 && <div className="text-slate-500">표시할 항목이 없습니다</div>}
        {!loading && questions.map(q=> <QuestionCard key={q.question_id} q={q} openAll={openAll} />)}
      </section>

      <footer className="text-xs text-slate-500 py-4">※ 점수는 루브릭 기반 자동 심사 결과입니다. 운영 시 사람 검수 병행 권장.</footer>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App/>);
