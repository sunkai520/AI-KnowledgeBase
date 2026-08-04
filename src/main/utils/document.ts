import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf"
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx"
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text"
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import fs from "fs";
import { parsePdf } from "./pdfParser";
// const nike10kPdfPath = "../../../../data/nke-10k-2023.pdf"
// const loader = new PDFLoader(nike10kPdfPath)
// 真正的 .docx 是 zip 结构，文件头固定是 "PK"；有些用户会把 .doc 直接改后缀名成 .docx，
// 内容其实还是旧二进制格式，光看扩展名会判断错，所以用文件头兜底识别真实格式。
export function isZipFile(filePath: string): boolean {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4);
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        return buffer[0] === 0x50 && buffer[1] === 0x4b;
    } catch {
        return false;
    }
}
function getWordExt(filePath: string): "doc" | "docx" {
    const base = filePath.split(/[\\/]/).pop() || '';
    const ext = base.split('.').pop()?.toLowerCase();
    if (ext === 'doc') return 'doc';
    return isZipFile(filePath) ? 'docx' : 'doc';
}
export class doc{
    textSplitter:any = null;
    loader:any = null;
    docType:string = "";
    constructor({docPath="",chunkSize=500,chunkOverlap=10}:any){
        this.textSplitter = new RecursiveCharacterTextSplitter({ chunkSize:chunkSize, chunkOverlap: chunkOverlap })
        if(!docPath){
            return
        }
        const loaderTp = this.getDocType(docPath)
        this.docType = loaderTp||"";
        switch (loaderTp) {
            case "pdf":
                this.loader = new PDFLoader(docPath)
                break;
            case "word":
                // .doc 是旧版二进制格式，不是 zip；DocxLoader 默认按 .docx(zip) 走 mammoth 解析会直接报错，
                // 必须显式传 type 让它按扩展名分流到 word-extractor(.doc) / mammoth(.docx)
                this.loader = new DocxLoader(docPath, { type: getWordExt(docPath) })
                break;
            case "ppt":
                this.loader = new PPTXLoader(docPath)
                break;
            case "excel":
                throw new Error("Excel not supported")
                break;
            case "txt":
                this.loader = new TextLoader(docPath)
                break;
            case "web":
                this.loader = new CheerioWebBaseLoader(docPath)
                break;
            default:
                throw new Error("文档类型为空")
                break;
        }
    }
    getDocType(filePath) {
        const parts = filePath.split(/[\\/]/).pop().split('.');
        const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
        if (/^https?:\/\//i.test(filePath)) {
            return 'web';
          }
        if (ext === 'pdf') return 'pdf';
        if (['doc', 'docx'].includes(ext)) return 'word';
        if (['ppt', 'pptx'].includes(ext)) return 'ppt';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
        if (['txt', 'md'].includes(ext)) return 'txt';
        // 无扩展名/未识别的后缀：调用方（chatServer）只在已判定为文本类文件时才会走到这里，兜底按纯文本读取
        if (!ext) return 'txt';
        return '';
      }
}
// 保留格式的展示用 HTML，仅用于富文本编辑器展示；向量化仍走 doc.loader 提取的纯文本，两者互不影响。
// mammoth 只支持 .docx（OOXML），旧版 .doc / pdf / txt 暂不支持结构化转换，返回 null 由调用方回退纯文本。
export async function getFormattedHtml(filePath: string): Promise<string | null> {
    const base = filePath.split(/[\\/]/).pop() || '';
    const parts = base.split('.');
    const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
    if (ext !== 'docx' || !isZipFile(filePath)) {
        return null;
    }
    try {
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ path: filePath });
        return result?.value || null;
    } catch (err) {
        console.error('HTML 格式转换失败，回退为纯文本展示', err);
        return null;
    }
}

// 表格单元格内容必须是单行：把段落换行压成 <br>，转义竖线避免破坏 Markdown 表格语法
function cellNodeToMarkdown(turndownService: any, cell: any): string {
    const html = cell.innerHTML || "";
    const md = String(turndownService.turndown(html) || "").trim();
    return md.replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
}

// Markdown 表格语法本身是个规规矩矩的网格，表达不了合并单元格；直接转发原始 <table> 会让 HTML 标签
// 泄漏进 Markdown 文本里。这里把 rowspan/colspan 都"展开"——合并单元格覆盖到的每一行/列都重复填入同一个值，
// 这样不管原表格有没有合并单元格，展开后都是规整网格，可以用标准 Markdown 表格语法输出，信息也不会丢。
function expandTableToGrid(turndownService: any, table: any): string[][] {
    const numRows: number = table.rows.length;
    const grid: string[][] = [];
    const occupied: boolean[][] = [];
    for (let r = 0; r < numRows; r++) {
        grid.push([]);
        occupied.push([]);
    }

    for (let r = 0; r < numRows; r++) {
        const row = table.rows[r];
        let col = 0;
        for (let ci = 0; ci < row.cells.length; ci++) {
            while (occupied[r][col]) col++;
            const cell = row.cells[ci];
            const value = cellNodeToMarkdown(turndownService, cell);
            const rowSpan = cell.rowSpan || 1;
            const colSpan = cell.colSpan || 1;
            for (let dr = 0; dr < rowSpan; dr++) {
                const rr = r + dr;
                if (rr >= numRows) continue;
                for (let dc = 0; dc < colSpan; dc++) {
                    const cc = col + dc;
                    grid[rr][cc] = value;
                    occupied[rr][cc] = true;
                }
            }
            col += colSpan;
        }
    }

    const maxCols = grid.reduce((m, row) => Math.max(m, row.length), 0);
    for (const row of grid) {
        for (let c = 0; c < maxCols; c++) {
            if (row[c] === undefined) row[c] = "";
        }
    }
    return grid;
}

function gridToMarkdownTable(grid: string[][]): string {
    if (grid.length === 0 || grid[0].length === 0) return "";
    const header = grid[0];
    const separator = header.map(() => "---");
    const lines = [
        `| ${header.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...grid.slice(1).map((row) => `| ${row.join(" | ")} |`),
    ];
    return lines.join("\n");
}

// 给需要"喂给大模型"的场景（比如写作画像的样本分析）用的格式保留方案：统一产出 Markdown。
// Markdown 比 HTML 轻量得多，噪声小，模型读起来也更自然，比直接丢纯文本能保留标题/列表/表格结构。
// PDF 直接复用 parsePdf 已经产出的 markdown；.docx 复用 getFormattedHtml 拿到 HTML 后再用 turndown 转一道；
// .doc（旧二进制）/ pptx 目前没有格式保留能力，返回 null，由调用方自行回退纯文本。
export async function getFormattedMarkdown(filePath: string): Promise<string | null> {
    const base = filePath.split(/[\\/]/).pop() || '';
    const parts = base.split('.');
    const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
    try {
        if (ext === 'pdf') {
            const parsed = await parsePdf(filePath);
            return parsed.markdown || null;
        }
        if (ext === 'docx' && isZipFile(filePath)) {
            const html = await getFormattedHtml(filePath);
            if (!html) return null;
            const { default: TurndownService } = await import('turndown');
            const { gfm } = await import('turndown-plugin-gfm');
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            // 自定义表格规则要在 use(gfm) 之前注册，才能抢在 gfm 插件的默认表格规则前面接管 <table>——
            // gfm 插件遇到合并单元格会直接放弃转换、原样吐出 HTML，所以这里的展开逻辑必须优先生效
            turndownService.addRule("expandedTable", {
                filter: "table",
                replacement: (content: string, node: any) => {
                    try {
                        const grid = expandTableToGrid(turndownService, node);
                        const table = gridToMarkdownTable(grid);
                        return table ? `\n\n${table}\n\n` : content;
                    } catch (err) {
                        console.error("表格展开失败，回退默认转换", err);
                        return content;
                    }
                },
            });
            turndownService.use(gfm);
            return turndownService.turndown(html) || null;
        }
        return null;
    } catch (err) {
        console.error('Markdown 格式转换失败，回退为纯文本', err);
        return null;
    }
}