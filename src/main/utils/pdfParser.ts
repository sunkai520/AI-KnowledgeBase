// PDF 解析公共方法：抽取文字 + 检测到大图时调用多模态聊天模型补充图片内容，
// 统一产出 markdown / html / text 三种格式，后续其他地方需要解析 PDF 都应该复用这个模块。
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { BrowserWindow } from "electron";
import MarkdownIt from "markdown-it";
import { PNG } from "pngjs";
import { getSystemPath, buildMultimodalContent } from "./common";
import { ModelFactory } from "../model/modelFactory";

export interface PdfParseResult {
    markdown: string;
    html: string;
    text: string;
    pageCount: number;
}

// 触发"这一页要不要额外做视觉识别"的图片面积阈值（像素），用来过滤掉图标/水印之类的小图
const SIGNIFICANT_IMAGE_PIXELS = 300 * 300;
// 单张截图喂给视觉模型的最大高度，扫描 App 拼接出来的长图会按这个高度切块，避免超出模型有效识别分辨率
const MAX_TILE_HEIGHT = 2200;
// 隐藏窗口渲染 PDF 页面等 Chromium 内置 PDF viewer 画完的等待时间
const RENDER_SETTLE_MS = 1200;
// 单页视觉识别（截图+调用聊天模型）的硬超时：窗口渲染卡住、模型请求挂起都会在这个时间后被强制中断，
// 不让某一页的异常拖死整份 PDF 的解析
const PAGE_VISION_TIMEOUT_MS = 60_000;

export type OnPdfProgress = (currentPage: number, totalPages: number) => void;

// pdfjs-dist 的 Node legacy 构建在较旧的 Node 版本上，其内部基于 process.getBuiltinModule 的
// 自动 polyfill 会静默失败，导致引用 DOMMatrix/Path2D/ImageData 时直接报错。这里手动兜底一份最小实现，
// 我们只用它做文字抽取和 operator list 分析，不依赖这几个对象的真实几何/像素运算，占位即可。
//
// 关键的另一点：pdf.js 内部也是靠 process.getBuiltinModule 是否存在来判断"是不是在 Node 里跑"，
// 从而决定 cmap/字体数据要不要走基于 fs 的本地文件读取器（NodeBinaryDataFactory）。这个判断失败时会
// 退回基于 fetch 的通用读取器，而 fetch 不支持 file:// 协议，字体编码表加载失败会导致文字被解析成空字符串——
// 这正是部分中文 PDF（尤其用了非标准内嵌字体编码的）文字抽取结果是空字符串的根因，必须一起 polyfill。
function ensurePdfjsPolyfills(): void {
    const g = globalThis as any;
    if (typeof process.getBuiltinModule !== "function") {
        (process as any).getBuiltinModule = (name: string) => require(name);
    }
    if (typeof g.DOMMatrix === "undefined") {
        g.DOMMatrix = class DOMMatrix {
            constructor() { }
        };
    }
    if (typeof g.Path2D === "undefined") {
        g.Path2D = class Path2D { };
    }
    if (typeof g.ImageData === "undefined") {
        g.ImageData = class ImageData {
            data: Uint8ClampedArray;
            width: number;
            height: number;
            constructor(dataOrWidth: any, widthOrHeight: number, height?: number) {
                if (dataOrWidth instanceof Uint8ClampedArray) {
                    this.data = dataOrWidth;
                    this.width = widthOrHeight;
                    this.height = height as number;
                } else {
                    this.width = dataOrWidth;
                    this.height = widthOrHeight;
                    this.data = new Uint8ClampedArray(this.width * this.height * 4);
                }
            }
        };
    }
}

// pdf.js 要求 cMapUrl/standardFontDataUrl 必须是以正斜杠结尾的字符串（哪怕在 Windows 上也不认反斜杠），
// 直接指向 pdfjs-dist 包内自带的 cmaps/standard_fonts 目录
function getPdfjsResourceUrl(subdir: string): string {
    const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
    return path.join(pdfjsRoot, subdir).replace(/\\/g, "/") + "/";
}

export async function parsePdf(filePath: string, onProgress?: OnPdfProgress, signal?: AbortSignal): Promise<PdfParseResult> {
    ensurePdfjsPolyfills();
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = fs.readFileSync(filePath);
    const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(data),
        useWorkerFetch: false,
        useSystemFonts: true,
        cMapUrl: getPdfjsResourceUrl("cmaps"),
        cMapPacked: true,
        standardFontDataUrl: getPdfjsResourceUrl("standard_fonts"),
    }).promise;

    const tempDir = path.join(getSystemPath("uploads"), "pdfTemp", `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
    const markdownParts: string[] = [];
    const textParts: string[] = [];

    try {
        for (let i = 1; i <= pdf.numPages; i++) {
            // 每页开始前检查一次：调用方（比如知识库上传）在这份文件被删除时会触发这个信号，
            // 提前结束整个解析，避免继续跑没有意义的后续页面（尤其是耗时的视觉识别）
            if (signal?.aborted) break;

            const page = await pdf.getPage(i);
            const pageText = await extractPageText(page);
            const imageHint = await detectSignificantImage(page, pdfjsLib);

            let supplement: string | null = null;
            if (imageHint) {
                supplement = await describePageWithVisionModel(filePath, i, pageText, tempDir, signal);
            }

            if (supplement) {
                markdownParts.push(pageText ? `${pageText}\n\n${supplement}` : supplement);
                textParts.push(pageText ? `${pageText}\n${supplement}` : supplement);
            } else {
                markdownParts.push(pageText);
                textParts.push(pageText);
            }
            onProgress?.(i, pdf.numPages);
        }
    } finally {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const markdown = markdownParts.join("\n\n---\n\n");
    const text = textParts.filter(Boolean).join("\n\n");
    const md = new MarkdownIt({ html: true, breaks: true, linkify: true });
    const html = md.render(markdown);

    return { markdown, html, text, pageCount: pdf.numPages };
}

// 同一行内允许的 Y 坐标抖动范围（不同字号/基线对齐会有小误差）
const ROW_Y_TOLERANCE = 3;

async function extractPageText(page: any): Promise<string> {
    const content = await page.getTextContent();
    const raw = content.items
        .filter((it: any) => "str" in it && it.str !== "")
        .map((it: any) => ({ str: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number }));
    if (raw.length === 0) return "";

    // pdf.js 按 PDF 内容流的绘制顺序返回文字对象，不是视觉阅读顺序——表单/表格类文档
    // （比如发票）经常是先统一画完所有标签、再统一画所有填充值，直接按原始顺序拼接会把
    // "标签一坨、数值一坨"分别堆在一起，读不出对应关系。这里按 Y 从上到下分行（容忍小范围抖动），
    // 行内再按 X 从左到右排序，还原成正常的阅读顺序。
    const sorted = [...raw].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; items: { x: number; str: string }[] }[] = [];
    for (const it of sorted) {
        const lastRow = rows[rows.length - 1];
        if (lastRow && Math.abs(lastRow.y - it.y) <= ROW_Y_TOLERANCE) {
            lastRow.items.push({ x: it.x, str: it.str });
        } else {
            rows.push({ y: it.y, items: [{ x: it.x, str: it.str }] });
        }
    }

    return rows
        .map((row) => row.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" "))
        .join("\n")
        .trim();
}

interface ImageHint {
    width: number;
    height: number;
}

// 只读 operator list 里绘制图片指令自带的宽高参数来判断"这页有没有大图"，不需要真正解码像素——
// pdf.js 在纯 Node 环境下解码像素依赖 canvas 渲染链路，没有 node-canvas 时 page.objs.get() 拿不到数据，
// 而宽高恰好是 paintImageXObject/paintJpegXObject 参数里现成的信息，足够用来做触发判断。
async function detectSignificantImage(page: any, pdfjsLib: any): Promise<ImageHint | null> {
    const opList = await page.getOperatorList();
    const imageOps = [pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintJpegXObject].filter((x: any) => x !== undefined);
    let biggest: ImageHint | null = null;
    for (let i = 0; i < opList.fnArray.length; i++) {
        if (!imageOps.includes(opList.fnArray[i])) continue;
        const args = opList.argsArray[i];
        const w = args?.[1];
        const h = args?.[2];
        if (typeof w !== "number" || typeof h !== "number") continue;
        if (w * h < SIGNIFICANT_IMAGE_PIXELS) continue;
        if (!biggest || w * h > biggest.width * biggest.height) biggest = { width: w, height: h };
    }
    return biggest;
}

// 借助 Electron 自带的 Chromium 内置 PDF viewer 把整页渲染成截图（不依赖 node-canvas 这类原生模块），
// 连同已提取的文字一起丢给多模态聊天模型，让模型补充图片里独有、文字没覆盖到的内容。
async function describePageWithVisionModel(
    pdfPath: string,
    pageNumber: number,
    existingText: string,
    tempDir: string,
    externalSignal?: AbortSignal
): Promise<string | null> {
    if (externalSignal?.aborted) return null;
    let win: BrowserWindow | null = null;
    // 硬超时兜底：窗口渲染卡住或模型请求挂起，超时后强制关窗口 + 中断请求，
    // 保证这一页最多拖这么久，不会让整份 PDF 卡死在这里；同时监听外部信号（比如文件被删除），
    // 两者共用同一个 controller 去中断正在进行的模型请求。
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        if (win && !win.isDestroyed()) win.close();
    }, PAGE_VISION_TIMEOUT_MS);
    const onExternalAbort = () => {
        controller.abort();
        if (win && !win.isDestroyed()) win.close();
    };
    externalSignal?.addEventListener("abort", onExternalAbort);
    try {
        fs.mkdirSync(tempDir, { recursive: true });
        win = new BrowserWindow({
            show: false,
            width: 1200,
            height: 1600,
            webPreferences: {
                plugins: true, // 打开 Chromium 内置 PDF viewer
                sandbox: true,
                contextIsolation: true,
            },
        });
        const fileUrl = `${pathToFileURL(pdfPath).href}#page=${pageNumber}&view=FitH`;
        await win.loadURL(fileUrl);
        if (externalSignal?.aborted) return null;
        // PDF viewer 内部渲染是异步的，给它一点时间把当前页画完
        await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
        if (externalSignal?.aborted) return null;
        const image = await win.webContents.capturePage();
        if (externalSignal?.aborted) return null;
        const pngBuffer = image.toPNG();
        const tilePaths = splitImageIntoTiles(pngBuffer, tempDir, pageNumber);

        const chatModel = ModelFactory.getChatModel();
        // Markdown 语法本身不支持对齐方式，标题/文字如果在原图里是居中的，必须显式提醒模型改用行内 HTML
        // （下游 markdown-it 开了 html:true，混排的 HTML 标签会原样透传渲染），否则一律会被渲成左对齐。
        const alignHint = `如果原图中的标题或某段文字是居中/右对齐的，请用 <div style="text-align:center"> 或 <div style="text-align:right"> 包裹对应内容（Markdown 本身无法表示对齐方式），其余部分正常用 Markdown 语法。`;
        const prompt = existingText
            ? `这是 PDF 第 ${pageNumber} 页的截图。已经从这一页提取到如下文字：\n${existingText}\n\n请阅读图片，把图片中有但上述文字没有覆盖到的内容（例如图表、扫描文字、表格等）用 Markdown 格式补充输出；不要重复已给出的文字，也不要输出无关说明。${alignHint}`
            : `这是 PDF 第 ${pageNumber} 页的截图（该页没有可提取的文字层，大概率是扫描件）。请把图片中的内容转录为结构化 Markdown（保留标题、列表、表格），只输出转录结果，不要输出多余说明。${alignHint}`;
        const content = buildMultimodalContent(prompt, tilePaths);
        const res: any = await chatModel.invoke([{ role: "user", content }], { signal: controller.signal });
        const output = typeof res?.content === "string"
            ? res.content
            : Array.isArray(res?.content)
                ? res.content.map((c: any) => c?.text || "").join("")
                : "";
        console.log(`[pdfParser] 第 ${pageNumber} 页视觉模型原始返回:`, JSON.stringify(res?.content));
        return output?.trim() || null;
    } catch (err) {
        if (externalSignal?.aborted) {
            console.log(`第 ${pageNumber} 页视觉补充解析已被外部取消（文件可能已被删除）`);
        } else if (timedOut) {
            console.error(`第 ${pageNumber} 页视觉补充解析超时（超过 ${PAGE_VISION_TIMEOUT_MS / 1000}s），已中断并跳过`);
        } else {
            console.error(`第 ${pageNumber} 页视觉补充解析失败，跳过图片内容`, err);
        }
        return null;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);
        if (win && !win.isDestroyed()) win.close();
    }
}

// 超高截图（比如扫描 App 拼接出来的长图）按最大高度切块，避免单张图超出视觉模型有效识别的分辨率
function splitImageIntoTiles(pngBuffer: Buffer, tempDir: string, pageNumber: number): string[] {
    const png = PNG.sync.read(pngBuffer);
    const tileCount = Math.ceil(png.height / MAX_TILE_HEIGHT);
    if (tileCount <= 1) {
        const filePath = path.join(tempDir, `p${pageNumber}-0.png`);
        fs.writeFileSync(filePath, pngBuffer);
        return [filePath];
    }
    const paths: string[] = [];
    for (let t = 0; t < tileCount; t++) {
        const startY = t * MAX_TILE_HEIGHT;
        const tileHeight = Math.min(MAX_TILE_HEIGHT, png.height - startY);
        const tile = new PNG({ width: png.width, height: tileHeight });
        PNG.bitblt(png, tile, 0, startY, png.width, tileHeight, 0, 0);
        const filePath = path.join(tempDir, `p${pageNumber}-${t}.png`);
        fs.writeFileSync(filePath, PNG.sync.write(tile));
        paths.push(filePath);
    }
    return paths;
}
