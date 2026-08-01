// 通用工具函数
import { RISK_TEXT_PATTERN } from "./constants";

/** 解析 "30-60K·15薪" → { lowK, highK, months }，失败返回 null */
export function parseSalary(
  desc: string
): { lowK: number; highK: number; months: number } | null {
  if (!desc) return null;
  const m = desc.match(/(\d+)\s*-\s*(\d+)\s*K/i);
  if (!m) return null;
  const monthsM = desc.match(/·\s*(\d+)\s*薪/);
  return {
    lowK: parseInt(m[1], 10),
    highK: parseInt(m[2], 10),
    months: monthsM ? parseInt(monthsM[1], 10) : 12,
  };
}

/** 年薪中位数（万元） */
export function annualMidpointWan(desc: string): number | null {
  const p = parseSalary(desc);
  if (!p) return null;
  return (((p.lowK + p.highK) / 2) * p.months) / 10;
}

/** 年薪区间分桶（万元） */
export const SALARY_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "10万以下", min: 0, max: 10 },
  { label: "10-20万", min: 10, max: 20 },
  { label: "20-30万", min: 20, max: 30 },
  { label: "30-50万", min: 30, max: 50 },
  { label: "50-80万", min: 50, max: 80 },
  { label: "80-120万", min: 80, max: 120 },
  { label: "120万以上", min: 120, max: Infinity },
];

export function salaryBucketLabel(desc: string): string | null {
  const v = annualMidpointWan(desc);
  if (v === null) return null;
  const b = SALARY_BUCKETS.find((x) => v >= x.min && v < x.max);
  return b ? b.label : null;
}

/** 从 JD 文本中提取高频词：中文 2-4 字 n-gram + 英文整词 */
export function extractWords(
  text: string,
  stopwords: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!text) return counts;
  const add = (w: string, weight = 1) => {
    if (!w || stopwords.has(w)) return;
    counts.set(w, (counts.get(w) || 0) + weight);
  };

  // 英文/技术词（保留大小写特征，如 Java、Go、C++）
  const en = text.match(/[A-Za-z][A-Za-z+#.\-]{1,20}/g) || [];
  for (const raw of en) {
    const w = raw.replace(/^[.\-]+|[.\-]+$/g, "");
    if (w.length < 2) continue;
    if (stopwords.has(w.toLowerCase())) continue;
    add(w, 3); // 英文技术词加权
  }

  // 中文 n-gram
  const runs = text.match(/[一-龥]{2,}/g) || [];
  const ngram = new Map<string, number>();
  for (const run of runs) {
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= run.length; i++) {
        const g = run.slice(i, i + len);
        if (stopwords.has(g)) continue;
        if (/^[的了和与及或在是有都对等很更最被把让给向您我他她它们这那其其中以及]+$/.test(g))
          continue;
        ngram.set(g, (ngram.get(g) || 0) + 1);
      }
    }
  }
  // 去冗余：若短 gram 完全包含于更长 gram 且频次不高于它，丢弃短 gram
  const entries = [...ngram.entries()].filter(([, c]) => c >= 2);
  const keep = new Map<string, number>();
  for (const [g, c] of entries) {
    let redundant = false;
    if (g.length < 4) {
      for (const [g2, c2] of entries) {
        if (g2.length > g.length && g2.includes(g) && c2 >= c) {
          redundant = true;
          break;
        }
      }
    }
    if (!redundant) keep.set(g, c);
  }
  for (const [g, c] of keep) add(g, c * (g.length - 1));
  return counts;
}

/** Map 取 Top N */
export function topN(
  counts: Map<string, number>,
  n: number
): { text: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([text, count]) => ({ text, count }));
}

export function countBy<T>(items: T[], key: (t: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function countMulti(items: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const arr of items) {
    for (const x of arr) {
      const k = (x || "").trim();
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** base64 → Blob */
export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const idx = s.indexOf("base64,");
      resolve(idx >= 0 ? s.slice(idx + 7) : s);
    };
    r.onerror = () => reject(new Error("读取文件失败"));
    r.readAsDataURL(file);
  });
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 模板变量替换 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string>
): string {
  return tpl.replace(/\{(公司|职位|自我介绍)\}/g, (_, k: string) => vars[k] ?? "");
}

/** 中国城市名模糊匹配（子序列匹配） */
export function fuzzyMatch(input: string, target: string): boolean {
  if (!input) return true;
  if (target.includes(input)) return true;
  let i = 0;
  for (const ch of target) {
    if (ch === input[i]) i++;
    if (i >= input.length) return true;
  }
  return false;
}

/** 错误文本是否指向风控/人机验证/未登录（需人工处理） */
export function isRiskText(s: string | null | undefined): boolean {
  if (!s) return false;
  return RISK_TEXT_PATTERN.test(s);
}

/** 是否本地时间的今天（接受 ISO 字符串或毫秒时间戳） */
export function isToday(time: string | number): boolean {
  const d = new Date(time);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
