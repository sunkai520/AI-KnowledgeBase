import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf"
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx"
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text"
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
// const nike10kPdfPath = "../../../../data/nke-10k-2023.pdf"
// const loader = new PDFLoader(nike10kPdfPath)
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
                this.loader = new DocxLoader(docPath)
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