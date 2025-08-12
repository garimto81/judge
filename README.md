# AI 답변 심사 리더보드 (Gemini 2.5 Pro)
여러 질문·답변을 업로드하면 GitHub Actions가 Google Sheets를 통해 **Gemini 2.5 Pro**로 자동 평가하고, GitHub Pages에 리더보드/질문별 상세를 노출합니다.

## 구성
- DB: Google Sheets (Apps Script 웹앱)
- 평가: scripts/judge.js (Node) → scores 시트 업데이트 → site/summary.json 빌드
- UI: site/ (정적, Tailwind)

## 설치
1) 시트 생성: `raw/scores/summary` 탭과 헤더 추가
2) Apps Script 배포: `SHEET_ID`, `TOKEN`을 Script Properties에 저장 → 웹앱 URL 확보
3) GitHub 레포 업로드 → Settings›Pages에서 `site/`로 Pages 활성화
4) GitHub Secrets: `GEMINI_API_KEY`, `GAS_URL`, `GAS_TOKEN`(필수), `WEIGHTS_JSON`(선택)
5) Actions 수동 실행 1회 → `site/summary.json` 생성 확인

## 업로드
- 사이트의 업로드 패널을 사용하거나 Apps Script에 직접 POST
- CSV 최소 컬럼: `question_id,question,model,answer_text`
- 중복 방지: `id`가 있으면 id 기준, 없으면 `(question_id,model,answer_text)` 해시 기준으로 무시

## 커스터마이즈
- 가중치: `WEIGHTS_JSON` 시크릿
- 길이 제한: `MAX_CHARS_PER_ANSWER`
- 강제 재채점: Actions dispatch 입력 혹은 `FORCE_REEVAL=true`

## 주의
- 공개 리더보드가 필요 없으면 `getSummary` 접근 제한 또는 Pages 비공개 운영
- LLM 심사는 편향이 있을 수 있으므로 중요 의사결정 시 **사람 검수** 병행 권장
