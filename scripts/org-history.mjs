// 진행 중 공고 상세에 필요한 기관별 통계와 최근 공고 5건을 만든다.
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../site/data/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const [bids, results] = await Promise.all([read('bids.json'), read('results.json')]);
const orgs = new Set(bids.items.map((bid) => bid.org));
const history = new Map();
const summary = () => ({ total: 0, won: 0, failed: 0, counted: 0, participants: 0, recent: [] });
const finish = ({ counted, participants, ...rest }) => ({ ...rest, average: counted ? participants / counted : null });

for (const r of results.items) {
  if (!orgs.has(r.org)) continue;
  if (!history.has(r.org)) history.set(r.org, { all: summary(), years: new Map() });
  const { all, years } = history.get(r.org);
  const date = r.openedAt || r.deadline || '';
  const year = date.match(/^([0-9]{4})-/)?.[1];
  if (year && !years.has(year)) years.set(year, summary());
  const members = r.contract?.members;
  const lead = members?.[0] || r.winner;
  const item = {
    id: r.id, title: r.title, date: date.slice(0, 10), failed: r.status === '유찰', participants: r.participants,
    amount: r.contract?.amount || r.winner?.amount || r.amount,
    lead: lead ? { name: lead.name, others: Math.max(0, (members?.length || 1) - 1) } : null,
  };
  for (const h of [all, years.get(year)].filter(Boolean)) {
    h.total++;
    if (r.winner || r.contract) h.won++;
    else if (r.status === '유찰') h.failed++;
    if (Number.isFinite(r.participants)) { h.counted++; h.participants += r.participants; }
    if (h.recent.length < 5) h.recent.push(item);
  }
}

const entries = [...history].map(([org, { all, years }]) => [
  org, { ...finish(all), years: Object.fromEntries([...years].map(([year, h]) => [year, finish(h)])) },
]);
await writeFile(new URL('org-history.json', dir), `[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);
console.log(`발주기관 이력 요약: ${entries.length}곳`);
