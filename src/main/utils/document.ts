import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf"
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx"
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text"
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import fs from "fs";
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