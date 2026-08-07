import { isZipFile } from "./document";

// 真实公文/情报模板极少使用 Word 的"标题1/标题2"命名样式——标题、"一、二、三"节标题、正文
// 全部是逐段直接格式化(手动改字体/字号)。所以这里不是简单读 styles.xml,而是直接分析
// document.xml 里每段的"最终生效格式"(直接格式 > 段落引用的命名样式 > Normal 默认值),
// 再用启发式规则把段落分成 标题/节标题/正文 三类。
//
// 字体/字号取的是"按字符数加权"的众数,而不是简单看每段第一个 run——很多公文里"（一）（二）"
// 这类段内小标题只是同一段落开头几个字换了字体(比如楷体),后面大段正文其实是另一种字体,
// 如果只看第一个 run 会把这种局部装饰误判成整段/整类的代表字体。

export interface ExtractedStyleTemplate {
  bodyFont?: string;
  bodySize?: number;
  firstLine?: number;
  lineSpacing?: number;
  lineRule?: string;
  paraAfter?: number;
  bodyAlign?: string;
  h1Font?: string;
  h1Size?: number;
  h1Bold?: boolean;
  h1Align?: string;
  h2Font?: string;
  h2Size?: number;
  h2Bold?: boolean;
  sourceLabel?: string;
  structureNote?: string;
}

interface RawProps {
  font?: string;
  size?: number;
  bold?: boolean;
  jc?: string;
  firstLine?: number;
  firstLineChars?: number;
  line?: number;
  lineRule?: string;
  after?: number;
}

interface RunInfo {
  text: string;
  font?: string;
  size?: number;
  bold?: boolean;
}

interface ParaInfo {
  text: string;
  pProps: RawProps;
  runs: RunInfo[];
}

interface StyleDef {
  id: string;
  basedOn?: string;
  raw: RawProps;
}

interface StylesIndex {
  byId: Map<string, StyleDef>;
  defaultId?: string;
}

// "一、" "1、" "第一章" 这类中文公文常见的节标题编号写法
const SECTION_HEADER_RE = /^([一二三四五六七八九十百]+[、.．]|\d+[、.．]\s?|第[一二三四五六七八九十百]+[章节部分条])/;

// 细分三种编号子类型,用来生成"结构规律"描述——喂给写作 prompt 时,
// 让 AI 知道具体该用哪种编号方式组织标题,而不是笼统地说"要分节"
const CN_NUM_HEADER_RE = /^[一二三四五六七八九十百]+[、.．]/;
const ARABIC_NUM_HEADER_RE = /^\d+[、.．]\s?/;
const CHAPTER_HEADER_RE = /^第[一二三四五六七八九十百]+[章节部分条]/;

function describeNumberingStyle(headerParas: ParaInfo[]): string | undefined {
  if (!headerParas.length) return undefined;
  let cn = 0, arabic = 0, chapter = 0;
  for (const p of headerParas) {
    const text = p.text.trim();
    if (CN_NUM_HEADER_RE.test(text)) cn++;
    else if (ARABIC_NUM_HEADER_RE.test(text)) arabic++;
    else if (CHAPTER_HEADER_RE.test(text)) chapter++;
  }
  const best = [
    { count: cn, note: "节标题使用“一、二、三、”中文数字加顿号编号" },
    { count: arabic, note: "节标题使用“1、2、3”阿拉伯数字编号" },
    { count: chapter, note: "节标题使用“第一章/第一节”这类章节编号" },
  ].sort((a, b) => b.count - a.count)[0];
  return best.count > 0 ? best.note : undefined;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function splitParagraphs(documentXml: string): string[] {
  return documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
}

function extractText(xml: string): string {
  const matches = xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
  return decodeXmlEntities(matches.map((m) => m.replace(/<[^>]*>/g, "")).join(""));
}

// 从一段 XML 片段里抠出字体/字号/加粗/对齐/首行缩进/行距——不区分调用方传进来的是
// 整个 rPr、整个 pPr 还是整个命名样式块,只要片段里含这些标签就能提取到。
// 注意:每个字段只在真的匹配到值时才赋值,绝不写入显式 undefined——因为调用方经常用
// {...低优先级, ...高优先级} 的方式合并多层属性,显式 undefined 会把低优先级已解析出的
// 有效值覆盖掉。
function parseRawProps(xml: string): RawProps {
  const props: RawProps = {};
  if (!xml) return props;

  const rFonts = xml.match(/<w:rFonts\b([^/>]*)\/>/);
  if (rFonts) {
    const attrs = rFonts[1];
    const eastAsia = attrs.match(/w:eastAsia="([^"]*)"/);
    const ascii = attrs.match(/w:ascii="([^"]*)"/);
    const font = (eastAsia && eastAsia[1]) || (ascii && ascii[1]);
    if (font) props.font = font;
  }

  const sz = xml.match(/<w:sz w:val="(\d+)"/);
  if (sz) props.size = parseInt(sz[1], 10);

  if (/<w:b\s*\/>/.test(xml)) props.bold = true;
  const bVal = xml.match(/<w:b\s+w:val="([^"]*)"/);
  if (bVal) props.bold = !/^(0|false)$/i.test(bVal[1]);

  const jc = xml.match(/<w:jc w:val="([^"]*)"/);
  if (jc) props.jc = jc[1];

  const ind = xml.match(/<w:ind\b([^/>]*)\/>/);
  if (ind) {
    const attrs = ind[1];
    const fl = attrs.match(/w:firstLine="(\d+)"/);
    const flc = attrs.match(/w:firstLineChars="(\d+)"/);
    if (fl) props.firstLine = parseInt(fl[1], 10);
    if (flc) props.firstLineChars = parseInt(flc[1], 10);
  }

  const spacing = xml.match(/<w:spacing\b([^/>]*)\/>/);
  if (spacing) {
    const attrs = spacing[1];
    const line = attrs.match(/w:line="(\d+)"/);
    const lineRule = attrs.match(/w:lineRule="([^"]*)"/);
    const after = attrs.match(/w:after="(\d+)"/);
    if (line) props.line = parseInt(line[1], 10);
    if (lineRule) props.lineRule = lineRule[1];
    if (after) props.after = parseInt(after[1], 10);
  }

  return props;
}

function parseStylesXml(stylesXml: string): StylesIndex {
  const byId = new Map<string, StyleDef>();
  let defaultId: string | undefined;
  const blocks = stylesXml.match(/<w:style\b[^>]*w:type="paragraph"[^>]*>[\s\S]*?<\/w:style>/g) || [];
  for (const b of blocks) {
    const idMatch = b.match(/w:styleId="([^"]*)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const basedOnMatch = b.match(/<w:basedOn w:val="([^"]*)"/);
    const openTag = b.slice(0, b.indexOf(">") + 1);
    const isDefault = /w:default="1"/.test(openTag);
    byId.set(id, { id, basedOn: basedOnMatch ? basedOnMatch[1] : undefined, raw: parseRawProps(b) });
    if (isDefault) defaultId = id;
  }
  return { byId, defaultId };
}

// 命名样式支持单层 w:basedOn 继承(真实样本里 heading2 的字号就是靠继承 Normal 拿到的),
// 深度限制 3 层纯粹是防御性的,避免样式表里出现循环引用时死循环
function resolveStyleProps(styleId: string | undefined, styles: StylesIndex, depth = 0): RawProps {
  if (!styleId || depth > 3) return {};
  const def = styles.byId.get(styleId);
  if (!def) return {};
  const base = def.basedOn ? resolveStyleProps(def.basedOn, styles, depth + 1) : {};
  return { ...base, ...def.raw };
}

function getPPr(p: string): string {
  const m = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : "";
}

function getPStyleId(pPr: string): string | undefined {
  const m = pPr.match(/<w:pStyle w:val="([^"]*)"/);
  return m ? m[1] : undefined;
}

// 拆出段落里每个真实 run 的文字和格式,每个 run 按自己的直接格式(缺失字段则向上找段落标记 rPr
// → 命名样式 → Normal 默认值)算出"生效格式"——这样同一段落里前半句楷体、后半句仿宋这种
// 局部换字体的写法,每个 run 各自的字体都能被正确识别,而不会被整段"一刀切"成同一种字体。
function getParaRuns(p: string, styles: StylesIndex): RunInfo[] {
  const pPr = getPPr(p);
  const styleProps = resolveStyleProps(getPStyleId(pPr), styles);
  const normalProps = resolveStyleProps(styles.defaultId, styles);
  const pPrRPrMatch = pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const pPrRPrProps = pPrRPrMatch ? parseRawProps(pPrRPrMatch[0]) : {};
  const baseProps = { ...normalProps, ...styleProps, ...pPrRPrProps };

  const pPrEnd = p.indexOf("</w:pPr>");
  const body = pPrEnd >= 0 ? p.slice(pPrEnd + "</w:pPr>".length) : p;
  const runMatches = body.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];

  const runs: RunInfo[] = [];
  for (const r of runMatches) {
    const text = extractText(r);
    if (!text) continue; // 跳过没有可见文字的 run(如书签、制表位)
    const rPrMatch = r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const runProps = rPrMatch ? parseRawProps(rPrMatch[0]) : {};
    runs.push({
      text,
      font: runProps.font ?? baseProps.font,
      size: runProps.size ?? baseProps.size,
      bold: runProps.bold ?? baseProps.bold,
    });
  }
  return runs;
}

function resolveFirstLineTwips(props: RawProps): number | undefined {
  if (props.firstLine !== undefined) return props.firstLine;
  if (props.firstLineChars !== undefined) {
    // docx 没写 firstLine(twips)时才需要换算:1 个全角字符宽度 ≈ 字号(pt) x 20 = 字号半磅数 x 10。
    // 这里拿不到具体字号,用常见正文字号(12pt=24半磅)兜底估算,实际精度不影响大局。
    const sizeHalfPt = props.size ?? 24;
    return Math.round(sizeHalfPt * 10 * (props.firstLineChars / 100));
  }
  return undefined;
}

function modeOf<T>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  for (const v of values) {
    if (v === undefined) continue;
    const key = String(v);
    const cur = counts.get(key);
    if (cur) cur.count++;
    else counts.set(key, { value: v, count: 1 });
  }
  let best: { value: T; count: number } | undefined;
  for (const c of counts.values()) {
    if (!best || c.count > best.count) best = c;
  }
  return best?.value;
}

// 按字符数加权求众数——覆盖字数最多的字体/字号/加粗组合,才是这一类段落"真正看起来"的样子
function weightedModeOf<T>(items: { value: T | undefined; weight: number }[]): T | undefined {
  const totals = new Map<string, { value: T; weight: number }>();
  for (const { value, weight } of items) {
    if (value === undefined || weight <= 0) continue;
    const key = String(value);
    const cur = totals.get(key);
    if (cur) cur.weight += weight;
    else totals.set(key, { value, weight });
  }
  let best: { value: T; weight: number } | undefined;
  for (const c of totals.values()) {
    if (!best || c.weight > best.weight) best = c;
  }
  return best?.value;
}

function dominantRunStyle(paras: ParaInfo[]): { font?: string; size?: number; bold?: boolean } {
  const fontItems: { value?: string; weight: number }[] = [];
  const sizeItems: { value?: number; weight: number }[] = [];
  const boldItems: { value?: boolean; weight: number }[] = [];
  for (const p of paras) {
    for (const r of p.runs) {
      const weight = r.text.length;
      fontItems.push({ value: r.font, weight });
      sizeItems.push({ value: r.size, weight });
      boldItems.push({ value: r.bold, weight });
    }
  }
  return {
    font: weightedModeOf(fontItems),
    size: weightedModeOf(sizeItems),
    bold: weightedModeOf(boldItems),
  };
}

export async function extractDocxStyleTemplate(
  filePath: string,
  sourceFileName?: string
): Promise<ExtractedStyleTemplate | null> {
  if (!isZipFile(filePath)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const docEntry = zip.getEntry("word/document.xml");
    if (!docEntry) return null;
    const documentXml = zip.readAsText(docEntry, "utf8");
    const stylesEntry = zip.getEntry("word/styles.xml");
    const stylesXml = stylesEntry ? zip.readAsText(stylesEntry, "utf8") : "";
    const styles = parseStylesXml(stylesXml);

    const paragraphs: ParaInfo[] = splitParagraphs(documentXml)
      .map((p) => ({
        text: extractText(p),
        pProps: parseRawProps(getPPr(p)),
        runs: getParaRuns(p, styles),
      }))
      .filter((p) => p.text.trim().length > 0);

    if (!paragraphs.length) return null;

    const [titlePara, ...rest] = paragraphs;
    const headerParas = rest.filter((p) => SECTION_HEADER_RE.test(p.text.trim()));
    const headerSet = new Set(headerParas);
    const bodyParas = rest.filter((p) => !headerSet.has(p));

    const result: ExtractedStyleTemplate = {};

    if (bodyParas.length) {
      const dom = dominantRunStyle(bodyParas);
      result.bodyFont = dom.font;
      result.bodySize = dom.size;
      result.firstLine = modeOf(bodyParas.map((p) => resolveFirstLineTwips(p.pProps)));
      result.lineSpacing = modeOf(bodyParas.map((p) => p.pProps.line));
      result.lineRule = modeOf(bodyParas.map((p) => p.pProps.lineRule));
      result.paraAfter = modeOf(bodyParas.map((p) => p.pProps.after));
      result.bodyAlign = modeOf(bodyParas.map((p) => p.pProps.jc));
    }

    const titleDom = dominantRunStyle([titlePara]);
    result.h1Font = titleDom.font;
    result.h1Size = titleDom.size;
    result.h1Bold = titleDom.bold ?? false;
    result.h1Align = titlePara.pProps.jc;

    if (headerParas.length) {
      const headerDom = dominantRunStyle(headerParas);
      result.h2Font = headerDom.font;
      result.h2Size = headerDom.size;
      result.h2Bold = headerDom.bold ?? false;
      result.structureNote = describeNumberingStyle(headerParas);
    }

    result.sourceLabel = sourceFileName ? `参考文档:${sourceFileName}` : undefined;

    const hasUsefulData = result.bodyFont || result.bodySize || result.h1Font || result.h1Size || result.h2Font || result.h2Size;
    return hasUsefulData ? result : null;
  } catch (err) {
    console.error("参考文档样式提取失败", err);
    return null;
  }
}
