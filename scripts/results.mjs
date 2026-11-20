// 마감된 공고의 결과를 모은다: 참여 업체 순위·투찰금액, 낙찰자, 계약(컨소시엄 구성사·지분).
// 대상은 진행 중 목록과 같은 조건(키워드·업종·제외어·금액·지역)에 맞는 공고다.
//
//   DATA_GO_KR_KEY=… node scripts/results.mjs
//
// 처음에는 config.backfillDays 만큼 지난 개찰 결과를 거슬러 모으고, 그 뒤로는 새 개찰만 본다.
// 한 번에 부르는 API 수를 config.maxCallsPerRun 으로 제한하고, 못 끝낸 공고는 다음 실행에서 잇는다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config, API, apiKey, kstStamp, parseKst, num, stats, callApi, wanted, regionOk, regionsOf, normalizeNotice } from './lib.mjs';

const OUT = path.join(ROOT, 'site', 'data', 'results.json');
const BIDS = path.join(ROOT, 'site', 'data', 'bids.json');
const STATE = path.join(ROOT, 'cache', 'results-state.json');
const DAY = 86400e3;
const BACKFILL_DAYS = config.backfillDays ?? 90;
const MAX_CALLS = config.maxCallsPerRun ?? 1500;
const FINAL_AFTER_DAYS = 120; // 개찰 뒤 이만큼 지나도 계약이 안 보이면 더 찾지 않는다

const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
if (!apiKey) { console.warn('DATA_GO_KR_KEY 가 없어 결과 수집을 건너뜁니다.'); process.exit(0); }

const data = await readJson(OUT, { items: [] });
const results = new Map(data.items.map((x) => [x.id, x]));
const state = await readJson(STATE, { scannedTo: null, excluded: {} });
const now = Date.now();
const budgetLeft = () => stats.calls < MAX_CALLS;

// 회사 목록 "[순번^역할^단독/공동^회사명^대표^국가^지분^…^^사업자번호],[…]" 을 나눈다.
function parseCorpList(s) {
  const out = [];
  for (const m of String(s || '').matchAll(/\[([^\]]*)\]/g)) {
    const f = m[1].split('^');
    if (f.length < 7) continue;
    out.push({ role: f[1] || '', type: f[2] || '', name: (f[3] || '').trim(), ceo: (f[4] || '').trim(), share: num(f[6]), bizno: (f[9] || '').replace(/\D/g, '') });
  }
  return out;
}

// ---------- 1. 후보 모으기 ----------
const candidates = new Map(); // id → { ord, title, org, keyword }
const add = (id, v) => { if (id && !state.excluded[id]) candidates.set(id, { ...candidates.get(id), ...v }); };
// 지난 실행에서 찾았지만 아직 못 채운 공고 (하루 호출 한도 때문에 여러 날에 걸쳐 채운다)
state.pending ||= {};
for (const [id, v] of Object.entries(state.pending)) add(id, v);
// 하루 호출 한도를 넘으면 이번 실행의 조회를 멈춘다
let quotaHit = false;
const isQuota = (m) => /요청제한|LIMITED_NUMBER|오류 22/.test(m);

// (가) 진행 중 목록에 있던 공고 중 마감이 지난 것
const bids = (await readJson(BIDS, { items: [] })).items;
for (const x of bids) {
  const dl = parseKst(x.deadline) ?? parseKst(x.detail?.opening);
  if (dl !== null && dl < now) add(x.id, { ord: x.ord, notice: x });
}

// (나) 개찰 결과를 키워드로 훑기. 조회 기간 한도(7일) 때문에 6일씩 끊는다.
//  - 최근: 지난번 훑은 때부터 지금까지
//  - 과거: config.backfillDays 까지 실행마다 조금씩 더 거슬러 간다(state.backfilledFrom).
//    오래된 기간에서 결과가 계속 0이면 API 에 데이터가 없는 것으로 보고 멈춘다(state.dataStart).
const BACKFILL_BUDGET = config.backfillCallsPerRun ?? 600;
let scanned = 0;
// 한 기간의 개찰 결과를 업종으로만 걸러 한 번에 받고, 키워드는 여기서 맞춘다(키워드마다 부르면 호출이 14배).
const kwMatch = (title) => config.keywords.find((k) => String(title || '').toLowerCase().includes(k.toLowerCase()));
async function scanWindow(b, e) {
  let rows = 0;
  for (let page = 1; ; page++) {
    if (!budgetLeft() || quotaHit) return null;
    const params = { inqryDiv: '1', inqryBgnDt: kstStamp(new Date(b)), inqryEndDt: kstStamp(new Date(e)), numOfRows: '100', pageNo: String(page) };
    if (config.industryCode) params.indstrytyCd = String(config.industryCode);
    let r;
    try { r = await callApi(API.scsbid, 'getOpengResultListInfoServcPPSSrch', params); } catch (err) { console.warn('개찰 목록 실패:', err.message); if (isQuota(err.message)) { quotaHit = true; return null; } return null; }
    rows += r.items.length;
    for (const it of r.items) {
      const keyword = kwMatch(it.bidNtceNm);
      if (!keyword || !wanted({ title: it.bidNtceNm, org: it.dminsttNm })) continue;
      add(it.bidNtceNo, { ord: it.bidNtceOrd || '000', keyword, open: { status: it.progrsDivCdNm || '', openedAt: it.opengDt || null, participants: num(it.prtcptCnum), note: (it.opengRsltNtcCntnts || '').trim(), rbid: it.rbidNo || '' } });
      scanned++;
    }
    if (page * 100 >= r.total || !r.items.length) break;
  }
  // 같은 기간의 낙찰자도 묶어서 받는다(공고마다 부르지 않으려고)
  for (let page = 1; ; page++) {
    if (!budgetLeft() || quotaHit) break;
    const params = { inqryDiv: '1', inqryBgnDt: kstStamp(new Date(b)), inqryEndDt: kstStamp(new Date(e)), numOfRows: '100', pageNo: String(page) };
    if (config.industryCode) params.indstrytyCd = String(config.industryCode);
    let r;
    try { r = await callApi(API.scsbid, 'getScsbidListSttusServcPPSSrch', params); } catch (err) { if (isQuota(err.message)) quotaHit = true; break; }
    for (const w of r.items) if (candidates.has(w.bidNtceNo) && w.bidwinnrNm) add(w.bidNtceNo, { win: { name: w.bidwinnrNm.trim(), bizno: (w.bidwinnrBizno || '').replace(/D/g, ''), ceo: (w.bidwinnrCeoNm || '').trim(), amount: num(w.sucsfbidAmt), rate: num(w.sucsfbidRate), date: w.fnlSucsfDate || null } });
    if (page * 100 >= r.total || !r.items.length) break;
  }
  return rows;
}
// 최근
const recentFrom = state.scannedTo ? state.scannedTo - DAY : now - 6 * DAY;
let recentOk = true;
for (let t = now; t > recentFrom; t -= 6 * DAY) {
  if ((await scanWindow(Math.max(recentFrom, t - 6 * DAY), t)) === null) { recentOk = false; break; }
}
if (recentOk) state.scannedTo = now;
// 과거
state.backfilledFrom ??= state.scannedTo ? now - 90 * DAY : now; // 처음 수집이 90일을 훑었다
const target = Math.max(now - BACKFILL_DAYS * DAY, state.dataStart || 0);
const backfillLimit = stats.calls + BACKFILL_BUDGET;
let emptyRun = state.emptyRun || 0;
while (state.backfilledFrom > target && stats.calls < backfillLimit && budgetLeft()) {
  const e = state.backfilledFrom, b = Math.max(target, e - 6 * DAY);
  const rows = await scanWindow(b, e);
  if (rows === null) break;
  state.backfilledFrom = b;
  emptyRun = rows ? 0 : emptyRun + 1;
  if (emptyRun >= 10) { state.dataStart = b; console.log('이보다 오래된 개찰 결과는 API 에 없어 보여 거슬러 가기를 멈춥니다:', new Date(b).toISOString().slice(0, 10)); break; }
}
state.emptyRun = emptyRun;
console.log(`과거 훑기: ${new Date(state.backfilledFrom).toISOString().slice(0, 10)}까지 (목표 ${new Date(target).toISOString().slice(0, 10)})`);
console.log(`개찰 목록 훑기: ${scanned}줄, 후보 ${candidates.size}건 (호출 ${stats.calls})`);

// ---------- 2. 공고별 결과 채우기 ----------
// 결과가 다 나온 공고는 다시 보지 않고, 계약만 기다리는 공고는 12시간에 한 번만 다시 본다.
const RECHECK = 12 * 3600e3;
const due = (r) => !r || (!r.final && (!r.checkedAt || now - Date.parse(r.checkedAt) > RECHECK || r.status === '개찰 전'));
for (const [id, r] of results) if (!r.final && !candidates.has(id)) candidates.set(id, { ord: r.ord });
const order = [...candidates.entries()]
  .filter(([id]) => due(results.get(id)))
  .sort((a, b) => (b[0] > a[0] ? 1 : -1)); // 공고번호가 클수록 최근

let done = 0, excludedNow = 0, failed = 0;
// 공고 여러 건을 동시에 조회한다(config.concurrency, 기본 5). 한도·인증 오류가 나면 모두 멈춘다.
let stop = false;
async function processOne(id, c) {
  const rec = results.get(id) || { id, ord: c.ord || '000' };
  try {
    // 공고 정보 (진행 중 목록에서 왔으면 그대로, 아니면 공고번호로 조회)
    if (!rec.title) {
      let n = c.notice;
      if (!n) {
        const r = await callApi(API.bid, 'getBidPblancListInfoServc02', { inqryDiv: '2', bidNtceNo: id, numOfRows: '10', pageNo: '1' });
        const it = r.items.sort((a, b) => (b.bidNtceOrd || '').localeCompare(a.bidNtceOrd || ''))[0];
        if (!it) { failed++; return; }
        n = normalizeNotice(it, c.keyword);
      }
      Object.assign(rec, {
        ord: n.ord, title: n.title, org: n.org, amount: n.amount, deadline: n.deadline, method: n.method,
        url: n.url, keywords: n.keywords, award: n.detail?.award || '', category: n.detail?.category || [],
        reNotice: !!n.detail?.reNotice, regions: n.regions,
      });
    }
    if (!wanted(rec)) { state.excluded[id] = '조건'; excludedNow++; return; }
    // 지역제한
    if (!rec.regions) {
      const r = await callApi(API.bid, 'getBidPblancListInfoPrtcptPsblRgn02', { inqryDiv: '2', bidNtceNo: id, bidNtceOrd: rec.ord, numOfRows: '50', pageNo: '1' });
      rec.regions = regionsOf(r.items);
    }
    if (!regionOk(rec)) { state.excluded[id] = '지역'; excludedNow++; return; }

    // 개찰 상태: 기간 조회에서 받은 게 있으면 그대로 쓰고, 없을 때만 공고별로 묻는다
    if (c.open && c.open.status) Object.assign(rec, { status: c.open.status, openedAt: c.open.openedAt, participants: c.open.participants, note: c.open.note });
    else {
    const op = await callApi(API.scsbid, 'getOpengResultListInfoServcPPSSrch', { inqryDiv: '3', bidNtceNo: id, numOfRows: '20', pageNo: '1' });
    const o = op.items.sort((a, b) => (b.rbidNo || '').localeCompare(a.rbidNo || ''))[0];
    if (o) {
      rec.status = o.progrsDivCdNm || '';
      rec.openedAt = o.opengDt || null;
      rec.participants = num(o.prtcptCnum);
      rec.note = (o.opengRsltNtcCntnts || '').trim();
    } else if (!rec.status) rec.status = '개찰 전';
    }
    if (c.win && !rec.winner) rec.winner = c.win;

    // 참여 업체 순위
    if (rec.status === '개찰완료' && !rec.bidders) {
      const r = await callApi(API.scsbid, 'getOpengResultListInfoOpengCompt', { bidNtceNo: id, bidNtceOrd: rec.ord, numOfRows: '200', pageNo: '1' });
      const lastRound = r.items.reduce((m, x) => ((x.rbidNo || '') > m ? x.rbidNo : m), '');
      rec.bidders = r.items
        .filter((x) => (x.rbidNo || '') === lastRound)
        .map((x) => ({ rank: num(x.opengRank), name: (x.prcbdrNm || '').trim(), bizno: (x.prcbdrBizno || '').replace(/\D/g, ''), ceo: (x.prcbdrCeoNm || '').trim(), amount: num(x.bidprcAmt), rate: num(x.bidprcrt), note: (x.rmrk || '').trim() }))
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    }
    // 낙찰자
    if (rec.status === '개찰완료' && !rec.winner) {
      const r = await callApi(API.scsbid, 'getScsbidListSttusServcPPSSrch', { inqryDiv: '3', bidNtceNo: id, numOfRows: '10', pageNo: '1' });
      const w = r.items[0];
      if (w && w.bidwinnrNm) rec.winner = { name: w.bidwinnrNm.trim(), bizno: (w.bidwinnrBizno || '').replace(/\D/g, ''), ceo: (w.bidwinnrCeoNm || '').trim(), amount: num(w.sucsfbidAmt), rate: num(w.sucsfbidRate), date: w.fnlSucsfDate || null };
    }
    // 계약 (컨소시엄 구성사·지분)
    if (rec.status === '개찰완료' && !rec.contract) {
      const r = await callApi(API.cntrct, 'getCntrctInfoListServcPPSSrch', { inqryDiv: '4', ntceNo: id, numOfRows: '10', pageNo: '1' });
      const k = r.items.sort((a, b) => (b.cntrctCnclsDate || '').localeCompare(a.cntrctCnclsDate || ''))[0];
      if (k) {
        rec.contract = {
          no: k.dcsnCntrctNo || k.untyCntrctNo, name: k.cntrctNm, date: k.cntrctCnclsDate || null,
          amount: num(k.totCntrctAmt), thisYear: num(k.thtmCntrctAmt), joint: k.cmmnCntrctYn === 'Y',
          method: k.cntrctCnclsMthdNm || '', reason: k.baseDtls || '', url: k.cntrctDtlInfoUrl || '',
          members: parseCorpList(k.corpList),
        };
      }
    }
    const opened = parseKst(rec.openedAt) ?? parseKst(rec.deadline);
    rec.final = !!rec.contract || rec.status === '유찰' || (opened !== null && now - opened > FINAL_AFTER_DAYS * DAY);
    rec.checkedAt = new Date().toISOString();
    results.set(id, rec);
    done++;
  } catch (e) {
    failed++;
    console.warn(`결과 조회 실패 ${id}: ${e.message}`);
    // 하루 한도를 넘겼으면 남은 공고도 모두 실패하니 여기서 멈추고 다음 실행에 잇는다
    if (isQuota(e.message)) { quotaHit = true; stop = true; return; }
    if (/등록되지 않은|게이트웨이/.test(e.message)) stop = true;
  }
}
const queue = [...order];
const CONC = Math.max(1, config.concurrency ?? 5);
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop && !quotaHit && budgetLeft()) {
    const [id, c] = queue.shift();
    await processOne(id, c);
  }
}));

// 조건에서 빠진 공고는 결과 목록에서도 뺀다(규칙이 바뀐 경우)
for (const [id, r] of results) if (!wanted(r) || !regionOk(r)) results.delete(id);

const items = [...results.values()].sort((a, b) => String(b.openedAt || b.deadline || '').localeCompare(String(a.openedAt || a.deadline || '')));
await mkdir(path.dirname(OUT), { recursive: true });
await mkdir(path.dirname(STATE), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: '조달청 나라장터 낙찰정보·계약정보서비스', items }, null, 1) + '\n');
// 아직 공고 정보도 못 채운 후보는 다음 실행으로 넘긴다
state.pending = {};
for (const [id, c] of candidates) if (!state.excluded[id] && !results.get(id)?.title) state.pending[id] = { ord: c.ord || '000', keyword: c.keyword, open: c.open, win: c.win };
if (quotaHit) console.warn('오늘 낙찰정보 API 호출 한도를 다 써서 나머지는 다음 실행에서 이어 갑니다.');
console.log(`다음 실행으로 넘긴 후보 ${Object.keys(state.pending).length}건`);
await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
const pending = order.length - done - excludedNow - failed;
console.log(`결과: 이번에 ${done}건 채움, ${excludedNow}건 조건 밖, ${failed}건 실패, 남은 ${Math.max(0, pending)}건 | 저장 ${items.length}건 | API 호출 ${stats.calls}회`);
