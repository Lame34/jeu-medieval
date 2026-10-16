/**
 * The instruments of the soundtrack (ADR-051): samples of the Versilian Community Sample Library
 * (VCSL, CC0 1.0) listed in scripts/music/samples.json, fetched at a pinned commit into
 * assets-src/raw/vcsl/ (git ignores it) and checked against their SHA-256. A file already there
 * and sound is kept. With --record, the hashes of a first download are written into the list.
 * Usage: node scripts/fetch-music-samples.ts [--record]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LIST = 'scripts/music/samples.json';
const OUT = 'assets-src/raw/vcsl';
const RAW = 'https://raw.githubusercontent.com/sgossner/VCSL';
/** Downloads at once: enough to be quick, few enough to be polite to the host. */
const PARALLEL = 6;

interface Sample {
  readonly path: string;
  readonly size: number;
  sha256: string;
}
interface SampleList {
  readonly commit: string;
  readonly groups: Record<string, Sample[]>;
}

const record = process.argv.includes('--record');
const list = JSON.parse(readFileSync(LIST, 'utf8')) as SampleList;
const samples = Object.values(list.groups).flat();
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function fetchOne(s: Sample): Promise<'kept' | 'fetched'> {
  const file = join(OUT, s.path);
  if (existsSync(file) && s.sha256 && sha256(readFileSync(file)) === s.sha256) return 'kept';
  const url = `${RAW}/${list.commit}/${s.path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${s.path}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length !== s.size) throw new Error(`${s.path}: ${data.length} bytes, ${s.size} expected`);
  const hash = sha256(data);
  if (s.sha256 && hash !== s.sha256) throw new Error(`${s.path}: SHA-256 ${hash}, ${s.sha256} expected`);
  if (!s.sha256 && !record) throw new Error(`${s.path}: no SHA-256 in ${LIST} (run with --record once)`);
  s.sha256 = hash;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return 'fetched';
}

let fetched = 0;
let kept = 0;
for (let i = 0; i < samples.length; i += PARALLEL) {
  const done = await Promise.all(samples.slice(i, i + PARALLEL).map(fetchOne));
  fetched += done.filter((d) => d === 'fetched').length;
  kept += done.filter((d) => d === 'kept').length;
}
if (record) writeFileSync(LIST, `${JSON.stringify(list, null, 2)}\n`);
console.log(`${samples.length} samples: ${fetched} fetched, ${kept} kept, in ${OUT}`);
