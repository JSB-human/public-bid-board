// 결과에 나온 회사들을 모아 회사별 이력·관계를 만들고, 기본정보·직원 수 추이·재무를 붙인다.
//
//   DATA_GO_KR_KEY=… DART_API_KEY=… node scripts/companies.mjs
//
// - 이력·관계: site/data/results.json 에서 계산 (API 호출 없음)
// - 기본정보: 조달청 사용자정보서비스 (30일마다 갱신)
// - 직원 수: 국민연금 가입 사업장 내역 (달마다 새 달만 추가)
// - 재무: DART (키가 있고 외부감사 대상인 회사만)
// 회사 정보는 cache/company/<사업자번호>.json 에 두고, 한 번에 config.maxCompanyCallsPerRun 만큼만 부른다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config, API, apiKey, num, stats, callApi, corpKey, budgetLeft as apiBudget, usageOf, saveUsage } from './lib.mjs';
import { unzip } from '../site/hwp.js';

const RESULTS = path.join(ROOT, 'site', 'data', 'results.json');
const OUT = path.join(ROOT, 'site', 'data', 'companies.json');
const CACHE = path.join(ROOT, 'cache', 'company');
const DART_CORPS = path.join(ROOT, 'cache', 'dart-corps.json');
const DAY = 86400e3;
// 조달업체·국민연금은 하루 10,000회라 넉넉하다. 한 번 실행이 너무 길어지지 않게만 막는다.
const MAX_CALLS = config.maxCompanyCallsPerRun ?? 3000;
const DART_KEY = process.env.DART_API_KEY || '';
const now = Date.now();
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };

// ---------- 1. 이력과 관계 ----------
const results = (await readJson(RESULTS, { items: [] })).items;
const companies = new Map();
const company = (bizno, name, ceo) => {
  if (!bizno) return null;
  let c = companies.get(bizno);
  if (!c) companies.set(bizno, (c = { bizno, name, ceo, history: [], partners: new Map(), rivals: new Map() }));
  if (name && (!c.name || name.length > c.name.length)) c.name = name;
  if (ceo && !c.ceo) c.ceo = ceo;
  return c;
};
const bump = (map, other, extra = {}) => {
  const e = map.get(other.bizno) || { bizno: other.bizno, name: other.name, count: 0, bids: [] };
  e.count++;
  if (extra.bid && !e.bids.includes(extra.bid)) e.bids.push(extra.bid);
  if (extra.share != null) e.shares = [...(e.shares || []), extra.share];
  map.set(other.bizno, e);
};

for (const r of results) {
  const base = { id: r.id, title: r.title, org: r.org, amount: r.amount, openedAt: r.openedAt || r.deadline, status: r.status };
  const winners = new Set();
  if (r.winner?.bizno) winners.add(r.winner.bizno);
  for (const m of r.contract?.members || []) if (m.bizno) winners.add(m.bizno);
  const members = r.contract?.members || [];
  const seen = new Set();
  // 입찰 참여 (대표사)
  for (const b of r.bidders || []) {
    const c = company(b.bizno, b.name, b.ceo);
    if (!c || seen.has(b.bizno)) continue;
    seen.add(b.bizno);
    const m = members.find((x) => x.bizno === b.bizno);
    c.history.push({ ...base, rank: b.rank, bidAmount: b.amount, rate: b.rate, won: winners.has(b.bizno), role: m?.role || '입찰', share: m?.share ?? null, contractAmount: m && r.contract?.amount && m.share != null ? Math.round((r.contract.amount * m.share) / 100) : null });
    // 같은 공고에서 겨룬 회사
    for (const o of r.bidders) if (o.bizno && o.bizno !== b.bizno) bump(c.rivals, o, { bid: r.id });
  }
  // 계약 구성사 (입찰엔 대표사만 나오므로 구성사는 여기서 더한다)
  for (const m of members) {
    const c = company(m.bizno, m.name, m.ceo);
    if (!c) continue;
    if (!seen.has(m.bizno)) {
      seen.add(m.bizno);
      c.history.push({ ...base, rank: null, bidAmount: null, rate: null, won: true, role: m.role, share: m.share, contractAmount: r.contract.amount && m.share != null ? Math.round((r.contract.amount * m.share) / 100) : null });
    }
    for (const o of members) if (o.bizno && o.bizno !== m.bizno) bump(c.partners, o, { bid: r.id, share: o.share });
  }
}
console.log(`회사 ${companies.size}곳 (결과 ${results.length}건에서)`);

// ---------- 2. 회사 정보 붙이기 ----------
await mkdir(CACHE, { recursive: true });
const budgetLeft = (base) => stats.calls < MAX_CALLS && (!base || apiBudget(base, 0.95));
// 많이 나온 회사부터
const ranked = [...companies.values()].sort((a, b) => b.history.length - a.history.length);

// DART 고유번호 목록 (회사명 → corp_code). 한 달에 한 번 받는다.
let dartCorps = null, dartOk = !!DART_KEY;
async function loadDartCorps() {
  const cached = await readJson(DART_CORPS, null);
  if (cached && now - Date.parse(cached.fetchedAt) < 30 * DAY) return cached.byKey;
  const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('DART 키 오류: ' + new TextDecoder().decode(buf.subarray(0, 200)).replace(/<[^>]+>/g, ' ').trim());
  const xml = new TextDecoder().decode(await unzip(buf)[0].read());
  const byKey = {};
  for (const m of xml.matchAll(/<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>/g)) {
    const k = corpKey(m[2]);
    (byKey[k] ||= []).push(m[1]);
  }
  await writeFile(DART_CORPS, JSON.stringify({ fetchedAt: new Date().toISOString(), byKey }) + '\n');
  return byKey;
}
async function dartJson(api, params) {
  stats.calls++;
  const qs = new URLSearchParams({ crtfc_key: DART_KEY, ...params });
  return (await fetch(`https://opendart.fss.or.kr/api/${api}.json?${qs}`)).json();
}

const ACCOUNTS = ['매출액', '영업이익', '당기순이익', '자산총계', '부채총계', '자본총계'];
let enriched = 0, warned = new Set();
const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn(msg); } };

for (const c of ranked) {
  const file = path.join(CACHE, c.bizno + '.json');
  const cache = await readJson(file, {});
  let changed = false;
  try {
    // 기본정보
    if (apiKey && budgetLeft(API.usr) && (!cache.basic || now - Date.parse(cache.basic.fetchedAt) > 30 * DAY)) {
      const r = await callApi(API.usr, 'getPrcrmntCorpBasicInfo02', { inqryDiv: '3', bizno: c.bizno, numOfRows: '5', pageNo: '1' });
      const b = r.items[0];
      cache.basic = b ? {
        name: b.corpNm, ceo: b.ceoNm, opened: (b.opbizDt || '').slice(0, 10), region: b.rgnNm, address: [b.adrs, b.dtlAdrs].filter(Boolean).join(' '),
        employees: num(b.emplyeNum), homepage: b.hmpgAdrs || '', kinds: b.corpBsnsDivNm || '', hq: b.hdoffceDivNm || '', fetchedAt: new Date().toISOString(),
      } : { missing: true, fetchedAt: new Date().toISOString() };
      if (b && !cache.industries) {
        const ind = await callApi(API.usr, 'getPrcrmntCorpIndstrytyInfo02', { inqryDiv: '3', bizno: c.bizno, numOfRows: '50', pageNo: '1' }).catch(() => ({ items: [] }));
        cache.industries = ind.items.map((x) => ({ name: x.indstrytyNm, main: x.rprsntIndstrytyYn === 'Y' })).filter((x) => x.name);
      }
      changed = true;
    }
    // 국민연금 직원 수 추이: 사업장 검색 결과가 달마다 한 줄씩 나오고, 달마다 상세를 불러 가입자 수를 얻는다.
    if (apiKey && budgetLeft(API.nps) && (!cache.nps || now - Date.parse(cache.nps.fetchedAt) > 20 * DAY)) {
      const nameKey = corpKey(c.name);
      const r = await callApi(API.nps, 'getBassInfoSearchV2', { wkplNm: c.name.replace(/주식회사|\(주\)|㈜/g, '').trim(), bzowrRgstNo: c.bizno.slice(0, 6), numOfRows: '100', pageNo: '1' });
      const rows = r.items.filter((x) => corpKey(x.wkplNm) === nameKey || corpKey(x.wkplNm).includes(nameKey));
      const months = cache.nps?.months || {};
      const byMonth = new Map();
      for (const x of rows) if (!byMonth.has(x.dataCrtYm)) byMonth.set(x.dataCrtYm, x.seq);
      const span = c.history.length >= 2 ? 12 : 1; // 한 번만 나온 회사는 최근 달만 본다(호출 절약)
      for (const [ym, seq] of [...byMonth].sort((a, b) => b[0].localeCompare(a[0])).slice(0, span)) {
        if (months[ym] != null || !budgetLeft(API.nps)) continue;
        const d = await callApi(API.nps, 'getDetailInfoSearchV2', { seq: String(seq), numOfRows: '1', pageNo: '1' });
        if (d.items[0]) months[ym] = num(d.items[0].jnngpCnt);
      }
      cache.nps = { months, found: rows.length > 0, fetchedAt: new Date().toISOString() };
      changed = true;
    }
    // DART 재무 (외부감사 대상 회사만 나온다)
    if (dartOk && budgetLeft() && (!cache.dart || now - Date.parse(cache.dart.fetchedAt) > 30 * DAY)) {
      try {
        dartCorps ??= await loadDartCorps();
        const codes = dartCorps[corpKey(c.name)] || [];
        let found = null;
        for (const code of codes.slice(0, 3)) {
          const info = await dartJson('company', { corp_code: code });
          if (info.status === '000' && (info.bizr_no || '').replace(/\D/g, '') === c.bizno) { found = { code, info }; break; }
        }
        const years = [];
        if (found) {
          const y0 = new Date().getFullYear() - 1;
          for (const y of [y0, y0 - 1, y0 - 2]) {
            const f = await dartJson('fnlttSinglAcnt', { corp_code: found.code, bsns_year: String(y), reprt_code: '11011' });
            if (f.status !== '000') continue;
            const list = (f.list || []).filter((x) => x.fs_div === 'OFS' || !f.list.some((z) => z.fs_div === 'OFS'));
            const row = { year: y };
            // 계정 이름이 "당기순이익(손실)"처럼 붙어 나오는 경우가 있어 앞부분으로 맞춘다.
            for (const a of ACCOUNTS) { const it = list.find((x) => String(x.account_nm || '').replace(/\s/g, '').startsWith(a)); if (it) row[a] = num(String(it.thstrm_amount).replace(/,/g, '')); }
            if (Object.keys(row).length > 1) years.push(row);
          }
        }
        cache.dart = { corpCode: found?.code || null, listed: found?.info?.stock_code ? true : false, years, fetchedAt: new Date().toISOString() };
        changed = true;
      } catch (e) {
        dartOk = false;
        warnOnce('dart', 'DART 조회를 건너뜁니다: ' + e.message);
      }
    }
  } catch (e) {
    warnOnce(e.message.slice(0, 40), `회사 정보 조회 실패 (${c.name}): ${e.message}`);
    if (/등록되지 않은|게이트웨이/.test(e.message)) break;
  }
  if (changed) { await writeFile(file, JSON.stringify(cache, null, 1) + '\n'); enriched++; }
  c.cache = cache;
}
for (const c of ranked) if (!c.cache) c.cache = await readJson(path.join(CACHE, c.bizno + '.json'), {});

// ---------- 3. 저장 ----------
const top = (map, n) => [...map.values()].sort((a, b) => b.count - a.count).slice(0, n)
  .map((e) => ({ bizno: e.bizno, name: e.name, count: e.count, share: e.shares?.length ? Math.round(e.shares.reduce((s, x) => s + x, 0) / e.shares.length) : undefined }));
const out = ranked.map((c) => {
  const h = c.history.sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')));
  const wins = h.filter((x) => x.won);
  const k = c.cache || {};
  return {
    bizno: c.bizno, name: k.basic?.name || c.name, ceo: k.basic?.ceo || c.ceo,
    stats: {
      // 참여: 대표사로 입찰했거나 컨소시엄 구성사로 들어간 공고 수
      bids: h.length, wins: wins.length,
      wonAmount: wins.reduce((s, x) => s + (x.contractAmount ?? (x.rank === 1 ? x.bidAmount : 0) ?? 0), 0),
      partners: c.partners.size, lastAt: h[0]?.openedAt || null,
    },
    basic: k.basic && !k.basic.missing ? { opened: k.basic.opened, region: k.basic.region, address: k.basic.address, employees: k.basic.employees, homepage: k.basic.homepage, kinds: k.basic.kinds } : null,
    industries: k.industries || [],
    nps: k.nps?.months ? Object.entries(k.nps.months).filter(([, v]) => v != null).sort((a, b) => a[0].localeCompare(b[0])).map(([ym, cnt]) => ({ ym, cnt })) : [],
    dart: k.dart?.years?.length ? k.dart.years : [],
    history: h,
    partners: top(c.partners, 20),
    rivals: top(c.rivals, 20),
  };
});
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items: out }, null, 1) + '\n');
console.log(`회사 정보: 이번에 ${enriched}곳 갱신, API 호출 ${stats.calls}회 | 저장 ${out.length}곳`);
await saveUsage();
console.log(`API 사용량(오늘): 조달업체 ${usageOf(API.usr)}, 국민연금 ${usageOf(API.nps)}`);
