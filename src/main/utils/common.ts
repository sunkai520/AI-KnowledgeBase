// @ts-ignore
import { getResourcesPath } from "../event/index"
import { dialog, BrowserWindow,app, nativeImage } from "electron";
import { DataPathManager } from './dataPathManager';
//@ts-ignore
import { doc } from "./document";
import { getDB } from "./getDb";
//@ts-ignore
import { ModelFactory } from '../model/modelFactory';
import crypto from "crypto";
const fs = require('fs');
const path = require('path');
export function getUUid() {
    const sessionId = crypto.randomBytes(16).toString("hex");
    return sessionId
}
//生成建表语法
export function createInsertSql(colums,tableName) {
    // 构建动态的 SQL 语句
    const columns = Object.keys(colums).join(', ');
    const values = Object.values(colums).map(() => '?').join(', ');
    return `INSERT INTO ${tableName} (${columns}) VALUES (${values})`
}
// 根据文件扩展名获取 MIME 类型
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.gif':
            return 'image/gif';
        case '.bmp':
            return 'image/bmp';
        case '.svg':
            return 'image/svg+xml';
        default:
            return 'application/octet-stream';  // 默认的 MIME 类型
    }
}

// 粗略估算文本 token 数：deepseek/qwen 等第三方模型没有官方 tokenizer 可调，用这个近似值即可。
// CJK 字符（中日韩）按 1 token/字符计（宁可略高估，让压缩早触发一点，好过真的超出模型上下文报错）；
// 其余字符（英文/数字/符号）按约 3.3 字符/token 计，贴近主流 BPE 分词器对英文的压缩比。
const CJK_RANGE = /[一-鿿぀-ヿ가-힯豈-﫿＀-￯]/;
export function estimateTokens(text: string): number {
    const str = String(text || "");
    if (!str) return 0;
    let cjkCount = 0;
    let otherCount = 0;
    for (const ch of str) {
        if (CJK_RANGE.test(ch)) cjkCount++;
        else otherCount++;
    }
    return Math.ceil(cjkCount + otherCount / 3.3);
}

// 将图片文件转换为 Base64 编码的函数。
// 发给模型前先按最长边缩到 maxDimension：多数视觉模型按分辨率分块计费，原图（手机拍照动辄几MB）
// 每次重发都是真金白银，缩小分辨率对模型"看懂"图片内容基本没影响。缩放失败（格式不支持等）时降级用原图，不影响图片正常发送。
export function convertImageToBase64(filePath, maxDimension = 1280) {
    const mimeType = getMimeType(filePath);
    try {
        const image = nativeImage.createFromPath(filePath);
        const { width, height } = image.getSize();
        if (width > 0 && height > 0 && Math.max(width, height) > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            const resized = image.resize({
                width: Math.max(1, Math.round(width * scale)),
                height: Math.max(1, Math.round(height * scale)),
                quality: 'good',
            });
            const isPng = mimeType === 'image/png';
            const buffer = isPng ? resized.toPNG() : resized.toJPEG(85);
            if (buffer && buffer.length > 0) {
                const outMime = isPng ? 'image/png' : 'image/jpeg';
                return `data:${outMime};base64,${buffer.toString('base64')}`;
            }
        }
    } catch (e) {
        // 缩放失败，降级为原图
    }
    const imageBuffer = fs.readFileSync(filePath);  // 读取文件内容
    const base64String = imageBuffer.toString('base64');  // 将图片转换为 Base64 编码
    return `data:${mimeType};base64,${base64String}`;  // 添加 MIME 类型前缀
}

/**
 * 构造多模态消息 content：
 * - 有图片时返回数组（image_url 条目 + text 条目）
 * - 无图片时返回纯字符串，与旧接口完全兼容
 */
export function buildMultimodalContent(text: string, imagePaths: string[]): any {
    if (!imagePaths || imagePaths.length === 0) return text;
    return [
        ...imagePaths.map(filePath => ({
            type: 'image_url',
            image_url: { url: convertImageToBase64(filePath) }
        })),
        { type: 'text', text }
    ];
}

// 判断文件类型的函数
// 无扩展名或扩展名不认识时的兜底：读文件头几百字节，没有 NUL 字节就当纯文本处理
// （很多人保存笔记/文档时不带后缀，比如直接从编辑器拖出来的"开发文档"）
function looksLikeText(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);
        const sample = buffer.subarray(0, bytesRead);
        return !sample.includes(0);
    } catch {
        return false;
    }
}

function getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(ext)) {
        return 'image';
    }
    if (['.pdf'].includes(ext)) {
        return 'pdf';
    }
    if (['.txt', '.docx', '.doc', '.rtf', '.md'].includes(ext)) {
        return 'text';
    }
    if (['.mp3', '.wav', '.flac'].includes(ext)) {
        return 'audio';
    }
    if (['.mp4', '.mkv', '.avi', '.mov'].includes(ext)) {
        return 'video';
    }
    if (looksLikeText(filePath)) {
        return 'text';
    }
    return 'Unknown';
}
// 把用户上传的附件拷贝进软件自己的目录，避免用户后续移动/改名/删除原文件导致历史记录里的附件失效。
// 文件名带时间戳+随机数前缀防重名，同时保留原始 basename 便于排查磁盘文件。
function copyIntoUploads(originalPath: string): string {
    const dir = path.join(getSystemPath('uploads'), 'attachments');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const destPath = path.join(dir, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${path.basename(originalPath)}`);
    fs.copyFileSync(originalPath, destPath);
    return destPath;
}

export async function selectFile(event) {
    let win: any = BrowserWindow.fromWebContents(event.sender);
    const result: any = await dialog.showOpenDialog(win, {
        title: "选择文件",
        properties: ["openFile", "multiSelections"],
        filters: [
            { name: "Documents", extensions: ["pdf", "docx", "ppt","pptx","txt", "png", "jpg", "jpeg"] },
            { name: "All Files", extensions: ["*"] },
        ],
    });

    if (result.canceled) return [];
    // 获取文件的路径和大小
    const filesWithSize = result.filePaths.map(originalPath => {
        const fileName = path.basename(originalPath);
        try {
            const filePath = copyIntoUploads(originalPath);
            const stats = fs.statSync(filePath);  // 使用同步的方式获取文件信息
            const sizeInBytes = stats.size;  // 获取文件大小（字节）
            const sizeFormatted = formatFileSize(sizeInBytes);  // 格式化文件大小
            const type = getFileType(filePath);

            return {
                filePath,
                sizeFormatted,
                fileName,
                type,
                content: type === "image" ? convertImageToBase64(filePath) : ""
            };
        } catch (err) {
            console.error('Error reading file stats:', err);
            return {
                filePath: originalPath,
                sizeFormatted: 'Error retrieving size',
                fileName,
                type: getFileType(originalPath),
                content: ""
            };
        }
    });

    return filesWithSize; // 返回文件路径和格式化后的大小
}
// 文件大小单位转换函数
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    else if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    else if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    else return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 剪贴板粘贴/拖拽——真实文件（比如在文件管理器里复制/拖出一个文件到输入框）：
// Electron 渲染进程能拿到磁盘真实路径，这里拷贝进软件自己的目录后再读取，避免引用用户原始文件路径。
export function resolvePastedFilePath(originalPath: string) {
    if (!originalPath || !fs.existsSync(originalPath)) return null;
    const fileName = path.basename(originalPath);
    const filePath = copyIntoUploads(originalPath);
    const stats = fs.statSync(filePath);
    const type = getFileType(filePath);
    return {
        filePath,
        sizeFormatted: formatFileSize(stats.size),
        fileName,
        type,
        content: type === 'image' ? convertImageToBase64(filePath) : '',
    };
}

// 历史消息里重新展示一个已经落盘的附件（不再拷贝，纯读取）：filePath 已经是 uploads/ 下的稳定路径，
// 用于消息记录回显缩略图/文档信息；文件被手动删除等极端情况下返回 null，由前端显示"文件已失效"。
export function readStoredAttachment(filePath: string) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    const type = getFileType(filePath);
    return {
        filePath,
        sizeFormatted: formatFileSize(stats.size),
        fileName: path.basename(filePath).replace(/^\d+-\d+-/, ''),
        type,
        content: type === 'image' ? convertImageToBase64(filePath) : '',
    };
}

// 剪贴板粘贴——图片数据（截图工具/网页复制的图片，没有对应的磁盘文件）：
// 把 base64 数据落盘到 uploads/pasted，返回结构跟文件选择器一致，前端不用区分这张图是选的还是粘贴的。
export function savePastedImage(dataUrl: string) {
    const matches = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
    if (!matches) return null;
    const buffer = Buffer.from(matches[2], 'base64');
    const dir = path.join(getSystemPath('uploads'), 'pasted');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `paste-${Date.now()}-${Math.round(Math.random() * 1e9)}.${matches[1] || 'png'}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return {
        filePath,
        sizeFormatted: formatFileSize(buffer.length),
        fileName: filename,
        type: 'image',
        content: dataUrl,
    };
}
/**
 * 时间戳转换
 * @param {number} date 时间戳 
 * @param {string} fmt 转换格式（例如：'yyyy.MM.dd'、'hh:mm:ss'、'yyyy-MM-dd hh:mm:ss'...）
 */
export function formatDate(date, fmt = "yyyy-MM-dd hh:mm:ss") {
    if (!date) return ''
    const newDate = new Date(date)
    if (/(y+)/.test(fmt)) {
        fmt = fmt.replace(RegExp.$1, (newDate.getFullYear() + '').substr(4 - RegExp.$1.length))
    }
    const o = {
        'M+': newDate.getMonth() + 1,
        'd+': newDate.getDate(),
        'h+': newDate.getHours(),
        'm+': newDate.getMinutes(),
        's+': newDate.getSeconds()
    }
    for (const k in o) {
        if (new RegExp(`(${k})`).test(fmt)) {
            const str = o[k] + ''
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length === 1) ? str : padLeftZero(str))
        }
    }
    return fmt
}

function padLeftZero(str) {
    return ('00' + str).substr(str.length)
}

export function isEmpty(obj, keys) {
    if (!obj || !keys) {
        return ""
    }
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i]
        if (!obj[key] && obj[key] !== 0) {
            return `${key}不能为空`
        }
    }
    return ""
}


export async function uploadDoc(event, path: any) {
    if (!path) {
        return false
    }
    let dbObj = getDB();
    let docObj = new doc({ docPath: path, chunkSize: 2000, chunkOverlap: 50 });
    let text = await docObj.loader.load()
    let stmt = dbObj.db.prepare("insert into texts(content,docType,docPath,createTime) values(?,?,?,?)");
    const result = stmt.run(text[0].pageContent, docObj.docType, path, formatDate(new Date().getTime()));
    let embdingModel = ModelFactory.getEmbeddingModel();

    if (result.lastInsertRowid !== null || result.lastInsertRowid !== undefined) {
        let texts = await docObj.textSplitter.splitText(text[0].pageContent);
        let vectors = await embdingModel.embedDocuments(texts);
        for (let i = 0; i < vectors.length; i++) {
            dbObj.insert(vectors[i], texts[i], result.lastInsertRowid)
        }
    }
    return true
}
//执行sql文件初始化数据库
export function createDataTable_school(db, sqlName) {
    const sqlFilePath = path.join(getResourcesPath(), `sql/${sqlName}.sql`);
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    db.exec(sql, function (execErr) {
        if (execErr) return console.error('执行 SQL 失败', execErr);
        console.log('✅ SQL 文件执行完毕');
        db.close();
    })
}
//判断目录是否存在若不存在创建他
export function createDir(path) {
    return new Promise((resolve, reject) => {
        fs.access(path, fs.constants.F_OK, (err) => {
            if (err) {
                // 目录不存在，创建目录
                fs.mkdir(path, { recursive: true }, (mkdirErr) => {
                    if (mkdirErr) {
                        reject(false)
                        console.error(mkdirErr, "文件创建失败");
                    } else {
                        resolve(true)
                    }
                });
            } else {
                resolve(true)
            }
        });
    })
}
export function getSystemPath(fileName){
    return DataPathManager.getInstance().getFilePath(fileName);
}