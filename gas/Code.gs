/**
 * Google Sheets REST facade (text/plain JSON)
 * GET  ?action=getRows&sheet=raw|scores
 * GET  ?action=getSummary                      // 모델 평균 + 질문별 랭킹 + 타임스탬프
 * POST { action:'appendRows', sheet:'raw', token, rows:[...] }
 * POST { action:'appendScores', token, rows:[...] }
 * - 중복 방지: raw는 id 또는 (question_id,model,answer_text 해시) 기준
 */

function _props(){ return PropertiesService.getScriptProperties(); }
function _ss(){ return SpreadsheetApp.openById(_props().getProperty('SHEET_ID')); }
function _sheet(name){ const sh=_ss().getSheetByName(name); if(!sh) throw new Error('No sheet '+name); return sh; }
function _ok(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function _err(msg, code){ return _ok({ ok:false, code:code||400, error:String(msg) }); }
function _nowIso(){ return new Date().toISOString(); }

function _headers(sh){ return sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=>String(h).trim()); }
function _readSheet(name){
  const sh=_sheet(name); const rng=sh.getDataRange(); const vals=rng.getValues(); if(vals.length<2) return [];
  const headers=vals[0];
  return vals.slice(1).filter(r=>r.some(c=>String(c).length)).map(row=>{ const o={}; headers.forEach((h,i)=>o[String(h).trim()]=row[i]); return o; });
}
function _appendRows(name, rows){
  if(!rows||!rows.length) return 0; const sh=_sheet(name); const headers=_headers(sh);
  const out=rows.map(r=>headers.map(h=> r[h]!==undefined? r[h] : ''));
  sh.getRange(sh.getLastRow()+1,1,out.length,headers.length).setValues(out); return out.length;
}
function _hash(s){ return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)).slice(0,22); }

function _rawExistingKeySet(){
  const rows=_readSheet('raw');
  const set={};
  rows.forEach(r=>{
    const key = r.id ? ('ID::'+r.id) : ('HK::'+_hash(String(r.question_id)+'\u0001'+String(r.model)+'\u0001'+String(r.answer_text)));
    set[key]=true;
  });
  return set;
}

function _appendRowsDedupRaw(rows){
  const sh=_sheet('raw'); const headers=_headers(sh);
  const existing=_rawExistingKeySet();
  const toIns=[];
  rows.forEach(r=>{
    const key = r.id ? ('ID::'+r.id) : ('HK::'+_hash(String(r.question_id)+'\u0001'+String(r.model)+'\u0001'+String(r.answer_text)));
    if(existing[key]) return; existing[key]=true;
    toIns.push(headers.map(h=> r[h]!==undefined? r[h] : ''));
  });
  if(!toIns.length) return 0;
  sh.getRange(sh.getLastRow()+1,1,toIns.length,headers.length).setValues(toIns);
  return toIns.length;
}

function doGet(e){
  try{
    const action=(e.parameter.action||'').trim();
    if(action==='getRows'){
      const name=(e.parameter.sheet||'raw').trim();
      return _ok({ ok:true, rows:_readSheet(name) });
    }
    if(action==='getSummary'){
      const scores=_readSheet('scores');
      const byModel={};
      scores.forEach(s=>{
        const m=String(s.model); if(!byModel[m]) byModel[m]={ n:0, sum_total:0, sum_accuracy:0,sum_completeness:0,sum_evidence:0,sum_actionability:0,sum_clarity:0,sum_safety:0 };
        byModel[m].n++;
        byModel[m].sum_total += Number(s.total)||0;
        byModel[m].sum_accuracy += Number(s.accuracy)||0;
        byModel[m].sum_completeness += Number(s.completeness)||0;
        byModel[m].sum_evidence += Number(s.evidence)||0;
        byModel[m].sum_actionability += Number(s.actionability)||0;
        byModel[m].sum_clarity += Number(s.clarity)||0;
        byModel[m].sum_safety += Number(s.safety)||0;
      });
      const models=Object.keys(byModel).map(m=>({
        model:m, n:byModel[m].n,
        mean_total: byModel[m].sum_total/byModel[m].n,
        mean_accuracy: byModel[m].sum_accuracy/byModel[m].n,
        mean_completeness: byModel[m].sum_completeness/byModel[m].n,
        mean_evidence: byModel[m].sum_evidence/byModel[m].n,
        mean_actionability: byModel[m].sum_actionability/byModel[m].n,
        mean_clarity: byModel[m].sum_clarity/byModel[m].n,
        mean_safety: byModel[m].sum_safety/byModel[m].n,
      }));

      const raw=_readSheet('raw');
      const entriesByQ={};
      function scoreKey(q,m){ return scores.find(s=>String(s.question_id)==String(q) && String(s.model)==String(m)); }
      raw.forEach(r=>{
        const qid=String(r.question_id);
        if(!entriesByQ[qid]) entriesByQ[qid]={ question_id:qid, question:r.question, entries:[] };
        const s=scoreKey(qid, r.model);
        entriesByQ[qid].entries.push({
          model:r.model,
          answer_text:r.answer_text,
          score: s ? {
            accuracy:Number(s.accuracy)||0,
            completeness:Number(s.completeness)||0,
            evidence:Number(s.evidence)||0,
            actionability:Number(s.actionability)||0,
            clarity:Number(s.clarity)||0,
            safety:Number(s.safety)||0,
            total:Number(s.total)||0,
            reason:s.reason||''
          } : null
        });
      });
      const questions=Object.values(entriesByQ).map(q=>{
        const ranked=q.entries.filter(e=>e.score).sort((a,b)=>b.score.total-a.score.total);
        return { ...q, ranking: ranked.map(e=>e.model) };
      });
      return _ok({ ok:true, models, questions, generated_at:_nowIso() });
    }
    return _err('Unknown action');
  }catch(err){ return _err(err); }
}

function doPost(e){
  try{
    if(!e.postData||!e.postData.contents) return _err('No body');
    const data=JSON.parse(e.postData.contents);
    const token=data.token; if(token!==_props().getProperty('TOKEN')) return _err('Unauthorized',401);

    if(data.action==='appendRows'){
      const n=_appendRowsDedupRaw(data.rows||[]);
      return _ok({ ok:true, inserted:n });
    }
    if(data.action==='appendScores'){
      const n=_appendRows('scores', data.rows||[]);
      return _ok({ ok:true, inserted:n });
    }
    return _err('Unknown action');
  }catch(err){ return _err(err); }
}
