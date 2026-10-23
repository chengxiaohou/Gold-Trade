// 轻量 xlsx 解析：只用浏览器原生 DecompressionStream + DOMParser，
// 不引入第三方依赖。支持 Excel 默认的 deflate / 存储两种压缩方式。

const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export type SheetCell = string | number | null;

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: SheetCell[][];
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

interface ZipReader {
  read: (name: string) => Promise<Uint8Array | null>;
}

function u16(v: DataView, p: number) {
  return v.getUint16(p, true);
}
function u32(v: DataView, p: number) {
  return v.getUint32(p, true);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 xlsx，请使用较新的 Chrome / Edge / Safari 打开');
  }
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw' as any));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function openZip(bytes: Uint8Array): Promise<ZipReader> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 从文件尾部查找 EOCD（End Of Central Directory）
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（未找到 ZIP 目录）');
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) break;
    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const fnLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const localOffset = u32(view, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + fnLen));
    entries.set(name, { name, method, compressedSize, localOffset });
    p += 46 + fnLen + extraLen + commentLen;
  }
  return {
    read: async (name: string) => {
      const entry = entries.get(name);
      if (!entry) return null;
      if (u32(view, entry.localOffset) !== 0x04034b50) return null;
      const fnLen = u16(view, entry.localOffset + 26);
      const extraLen = u16(view, entry.localOffset + 28);
      const start = entry.localOffset + 30 + fnLen + extraLen;
      const raw = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflateRaw(raw);
      throw new Error(`不支持的 xlsx 压缩方式：${entry.method}`);
    },
  };
}

function parseXml(bytes: Uint8Array): Document {
  const text = new TextDecoder('utf-8').decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Excel XML 内容解析失败');
  return doc;
}

function colIndexFromRef(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function textOf(el: Element): string {
  const ts = el.getElementsByTagNameNS(XML_NS, 't');
  let s = '';
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent || '';
  return s;
}

export async function parseXlsxFile(file: File): Promise<ParsedSheet> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = await openZip(bytes);

  // 1. 找到要解析的工作表（优先“持仓数据”，否则第一张表）
  const wbBytes = await zip.read('xl/workbook.xml');
  if (!wbBytes) throw new Error('xlsx 缺少 workbook.xml');
  const wb = parseXml(wbBytes);
  const sheets = Array.from(wb.getElementsByTagNameNS(XML_NS, 'sheet'));
  if (sheets.length === 0) throw new Error('xlsx 中没有工作表');

  const relBytes = await zip.read('xl/_rels/workbook.xml.rels');
  const relMap = new Map<string, string>();
  if (relBytes) {
    const rels = parseXml(relBytes).getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      const id = rels[i].getAttribute('Id') || '';
      const target = rels[i].getAttribute('Target') || '';
      if (id && target) relMap.set(id, target);
    }
  }

  const pick = sheets.find(s => s.getAttribute('name') === '持仓数据') || sheets[0];
  const sheetName = pick.getAttribute('name') || 'Sheet1';
  const rid = pick.getAttributeNS(REL_NS, 'id') || pick.getAttribute('r:id') || '';
  const target = relMap.get(rid) || 'worksheets/sheet1.xml';
  const sheetPath = target.startsWith('/')
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, '')}`;
  const sheetBytes = await zip.read(sheetPath) || await zip.read('xl/worksheets/sheet1.xml');
  if (!sheetBytes) throw new Error('xlsx 中找不到工作表数据');

  // 2. 共享字符串
  const shared: string[] = [];
  const ssBytes = await zip.read('xl/sharedStrings.xml');
  if (ssBytes) {
    const ssDoc = parseXml(ssBytes);
    const sis = ssDoc.getElementsByTagNameNS(XML_NS, 'si');
    for (let i = 0; i < sis.length; i++) shared.push(textOf(sis[i]));
  }

  // 3. 读取单元格
  const sheetDoc = parseXml(sheetBytes);
  const rowEls = Array.from(sheetDoc.getElementsByTagNameNS(XML_NS, 'row'));
  const matrix: SheetCell[][] = [];
  for (const rowEl of rowEls) {
    const cells = Array.from(rowEl.getElementsByTagNameNS(XML_NS, 'c'));
    const row: SheetCell[] = [];
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci];
      const ref = c.getAttribute('r') || '';
      const idx = ref ? colIndexFromRef(ref) : ci;
      const t = c.getAttribute('t') || '';
      let value: SheetCell = null;
      const is = c.getElementsByTagNameNS(XML_NS, 'is')[0];
      if (is) {
        value = textOf(is);
      } else {
        const v = c.getElementsByTagNameNS(XML_NS, 'v')[0];
        if (v && v.textContent != null && v.textContent !== '') {
          const raw = v.textContent;
          if (t === 's') value = shared[Number(raw)] ?? null;
          else if (t === 'str' || t === 'e') value = raw;
          else if (t === 'b') value = raw === '1' ? 1 : 0;
          else {
            const num = Number(raw);
            value = Number.isFinite(num) ? num : raw;
          }
        }
      }
      while (row.length < idx) row.push(null);
      row[idx] = value;
    }
    matrix.push(row);
  }

  // 4. 第一行非空行作为表头，之后为数据；跳过“汇总”行
  const isBlank = (r: SheetCell[]) => r.every(v => v == null || String(v).trim() === '');
  let headerRowIdx = matrix.findIndex(r => !isBlank(r));
  if (headerRowIdx < 0) throw new Error('工作表内容为空');
  const rawHeaders = matrix[headerRowIdx].map(v => v == null ? '' : String(v).trim());
  let lastCol = rawHeaders.length - 1;
  while (lastCol >= 0 && rawHeaders[lastCol] === '') lastCol--;
  const headers = rawHeaders.slice(0, lastCol + 1).map((h, i) => h || `列${i + 1}`);

  const rows: SheetCell[][] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (isBlank(r)) continue;
    if (String(r[0] ?? '').trim() === '汇总') continue;
    const cells = headers.map((_, ci) => r[ci] ?? null);
    rows.push(cells);
  }

  return { sheetName, headers, rows };
}
