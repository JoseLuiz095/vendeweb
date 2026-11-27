import { inflateSync } from 'three/examples/jsm/libs/fflate.module.js';

export type ImportedFilament = { slot: string; type: string; color: string; grams: number | null };
export type ImportedPlate = { id: string; name: string; hours: number | null; grams: number | null; printer: string; filaments: ImportedFilament[] };
export type PrintImport = { filename: string; sha256: string; format: '3mf' | 'gcode'; plates: ImportedPlate[] };
const MAX_FILE = 25 * 1024 * 1024, MAX_META = 2 * 1024 * 1024;
const decoder = new TextDecoder();
const positive = (value: string | undefined, limit = 1_000_000): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 && n <= limit ? n : null;
};
const decode = (s: string) => s.replace(/&(amp|quot|apos|lt|gt);/g, (_, key: string) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key] || ''));
const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], decode(m[2])]));

/** Passive metadata reader. No models/G-code are executed or extracted to disk. */
export function parseSliceInfo(xml: string): ImportedPlate[] {
  if (xml.length > MAX_META || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Metadados XML inválidos.');
  const plates = [...xml.matchAll(/<plate\b([^>]*)>([\s\S]*?)<\/plate>/g)].map((match, index) => {
    const meta = {...attrs(match[1])};
    for (const m of match[2].matchAll(/<metadata\b([^>]*?)\/?\s*>/g)) { const a = attrs(m[1]); if (a.key) meta[a.key] = a.value; }
    const filaments = [...match[2].matchAll(/<filament\b([^>]*?)\/?\s*>/g)].map(m => {
      const a = attrs(m[1]); return { slot: a.id || '', type: a.type || '', color: a.color || '', grams: positive(a.used_g) };
    });
    if (filaments.length > 30) throw new Error('A mesa excede 30 filamentos.');
    const object = /<object\b([^>]*?)\/?\s*>/.exec(match[2]);
    const seconds = positive(meta.prediction, 3_600_000_000);
    return { id: meta.index || String(index + 1), name: object ? attrs(object[1]).name || `Mesa ${index+1}` : `Mesa ${index+1}`,
      hours: seconds === null ? null : seconds / 3600, grams: positive(meta.weight), printer: meta.printer_model_id || '', filaments };
  });
  if (!plates.length || plates.length > 100 || new Set(plates.map(p=>p.id)).size !== plates.length) throw new Error('Não foi possível identificar as mesas fatiadas. Exporte o arquivo depois de fatiar.');
  return plates;
}

function crc32(bytes: Uint8Array) {
  let crc = -1; for (const b of bytes) { crc ^= b; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0;
}

// Read just slice_info.config. Bounded output prevents ZIP bombs, including forged sizes.
export function sliceInfoFromZip(bytes: Uint8Array): string {
  if(bytes.length<22)throw new Error('Arquivo ZIP/3MF inválido.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0,bytes.length-65557); end--) if (v.getUint32(end,true) === 0x06054b50) break;
  if (end < 0 || v.getUint32(end,true) !== 0x06054b50 || v.getUint16(end+4,true) || v.getUint16(end+6,true)) throw new Error('Arquivo ZIP/3MF inválido.');
  const count=v.getUint16(end+10,true), centralSize=v.getUint32(end+12,true); let offset=v.getUint32(end+16,true);
  if (count > 4096 || !count || offset+centralSize > end) throw new Error('Estrutura 3MF não suportada.');
  let found: Uint8Array | undefined;
  for (let i=0;i<count;i++) {
    if (offset+46> end || v.getUint32(offset,true)!==0x02014b50) throw new Error('Diretório 3MF inválido.');
    const flags=v.getUint16(offset+8,true), method=v.getUint16(offset+10,true), crc=v.getUint32(offset+16,true), compressed=v.getUint32(offset+20,true), size=v.getUint32(offset+24,true);
    const length=v.getUint16(offset+28,true), extra=v.getUint16(offset+30,true), comment=v.getUint16(offset+32,true), local=v.getUint32(offset+42,true);
    if (offset+46+length+extra+comment>end) throw new Error('Diretório 3MF truncado.');
    const name=decoder.decode(bytes.subarray(offset+46,offset+46+length)); offset+=46+length+extra+comment;
    if (name !== 'Metadata/slice_info.config') continue;
    if (found || flags & 1 || ![0,8].includes(method) || size>MAX_META || compressed>MAX_META || !size || size>Math.max(1024,compressed*200)) throw new Error('Metadados 3MF excedem os limites de leitura segura.');
    if (local+30>bytes.length || v.getUint32(local,true)!==0x04034b50) throw new Error('Entrada 3MF inválida.');
    const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
    if (start+compressed>bytes.length) throw new Error('Entrada 3MF truncada.');
    const data=bytes.subarray(start,start+compressed);
    found=method===0 ? data : inflateSync(data,{out:new Uint8Array(size)});
    if (found.length!==size || crc32(found)!==crc) throw new Error('Metadados 3MF corrompidos.');
  }
  if (!found) throw new Error('Este 3MF não contém estimativas de fatiamento. No Bambu Studio, fatie e exporte o arquivo fatiado (.gcode.3mf).');
  return decoder.decode(found);
}

export function parseGcode(text: string): ImportedPlate {
  const time=/;\s*(?:model printing time|estimated printing time\s*\(normal mode\))\s*[:=]\s*([^;\r\n]+)/i.exec(text)?.[1];
  let hours: number | null=null;
  if (time) { const parts=[...time.matchAll(/([\d.]+)\s*(d|h|m|s)/g)]; if(parts.length) hours=parts.reduce((n,m)=>n+Number(m[1])*({d:24,h:1,m:1/60,s:1/3600}[m[2]] || 0),0); }
  const weight=/;\s*(?:total filament weight\s*\[g\]|filament used\s*\[g\])\s*[:=]\s*([^\r\n]+)/i.exec(text)?.[1];
  const grams=weight ? weight.split(',').map(s=>positive(s.trim())).reduce<number|null>((a,b)=>a===null||b===null?null:a+b,0) : null;
  if (hours===null && grams===null) throw new Error('G-code sem tempo ou peso reconhecível. Preencha manualmente ou use o 3MF fatiado.');
  if (hours!==null && (!Number.isFinite(hours) || hours>1_000_000)) throw new Error('Tempo fora dos limites.');
  return {id:'1',name:'Impressão do G-code',hours,grams,printer:/;\s*printer_model\s*=\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() || '',filaments:[]};
}

export async function importPrintFile(file: File): Promise<PrintImport> {
  if (!file.size || file.size>MAX_FILE || !/\.(3mf|gcode)$/i.test(file.name)) throw new Error('Use 3MF fatiado ou G-code de até 25 MiB.');
  const buffer=await file.arrayBuffer(), bytes=new Uint8Array(buffer);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  const format=/\.3mf$/i.test(file.name)?'3mf':'gcode';
  const plates=format==='3mf' ? parseSliceInfo(sliceInfoFromZip(bytes)) : [parseGcode(decoder.decode(bytes.subarray(0,MAX_META/2))+'\n'+decoder.decode(bytes.subarray(Math.max(MAX_META/2,bytes.length-MAX_META/2))))];
  return {filename:file.name.slice(0,200),sha256,format,plates};
}
