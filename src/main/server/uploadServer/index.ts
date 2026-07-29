// @ts-ignore
import { success, error500, error } from "../responseFn"
// @ts-ignore
import { formatDate, getSystemPath } from "../../utils/common"
// @ts-ignore
import { extractPosterFrame } from "../../model/videoComposer"
const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadServer = express.Router();
const fs = require('fs');
// 懒加载路径：每次请求时动态获取，保证数据目录变更后始终正确
function getUploadDir() {
    return getSystemPath('uploads');
}
function getSubDir(type: string) {
    const base = getUploadDir();
    const dir = path.join(base, type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// 配置存储
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const fileType = req.params.type;
        cb(null, getSubDir(fileType || ''));
    },
    filename: function (req, file, cb) {
        // 生成唯一文件名: 时间戳-随机数-原始文件名
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
    const fileType = req.params.type;
    const allowedTypes = {
        images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
        videos: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
        attachments: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip',
            'application/x-rar-compressed',
            'text/plain',
            'text/markdown'
        ]
    };

    if (allowedTypes[fileType] && allowedTypes[fileType].includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`不支持的文件类型: ${file.mimetype}. 请上传 ${fileType} 类型的文件`), false);
    }
};

// 配置 multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 100 * 1024 * 1024 // 限制 100MB
    }
});

// 静态文件服务 - 每次请求时动态解析目录，保证路径始终正确
uploadServer.use('/uploads/:type', (req: any, res: any, next: any) => {
    const dir = getSubDir(req.params.type);
    express.static(dir)(req, res, next);
});

// 统一的上传接口
// POST /upload/:type (images|videos|attachments)
uploadServer.post('/upload/:type', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.send(error500("没有文件被上传"))
        }

        const { type } = req.params;
        const protocol = req.protocol;
        const host = req.get('host');
        // 构建访问 URL
        const fileUrl = `${protocol}://${host}/uploads/${type}/${req.file.filename}`;
        res.send(success({
            originalName: req.file.originalname,
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            size: req.file.size,
            url: fileUrl,
            path: req.file.path
        }))
    } catch (error: any) {
        res.send(error500("上传失败"))
    }
});

// 多文件上传接口
// POST /upload/:type/multiple
uploadServer.post('/upload/:type/multiple', upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: '没有文件被上传'
            });
        }
        const { type } = req.params;
        const protocol = req.protocol;
        const host = req.get('host');
        const files = req.files.map(file => ({
            originalName: file.originalname,
            filename: file.filename,
            mimetype: file.mimetype,
            size: file.size,
            url: `${protocol}://${host}/uploads/${type}/${file.filename}`,
            path: file.path
        }));
        res.json({
            success: true,
            message: `成功上传 ${files.length} 个文件`,
            data: files
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: '上传失败',
            error: error.message
        });
    }
});

// 获取文件信息接口
uploadServer.get('/file/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const filePath = path.join(getUploadDir(), type, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            success: false,
            message: '文件不存在'
        });
    }

    const stats = fs.statSync(filePath);
    const protocol = req.protocol;
    const host = req.get('host');

    res.json({
        success: true,
        data: {
            filename: filename,
            url: `${protocol}://${host}/uploads/${type}/${filename}`,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime
        }
    });
});

// 删除文件接口
uploadServer.delete('/file/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const filePath = path.join(getUploadDir(), type, filename);
    if (!fs.existsSync(filePath)) {
        return res.send(error500("文件不存在"))
    }
    try {
        fs.unlinkSync(filePath);
        res.send(success())
    } catch (error: any) {
        res.send(error500("操作失败"))
    }
});

// ─── 创作管理：AI 生成的图片/视频（uploads/generated/images|videos） ──────────────
const GENERATED_SUBDIRS = { image: 'images', video: 'videos' };

// 视频封面缓存目录：文件名和视频一一对应，存在即复用，不重复截帧
const THUMB_SUBDIR = 'videoThumbs';
function posterPathFor(videoFilename: string) {
    const dir = path.join(getUploadDir(), 'generated', THUMB_SUBDIR);
    const posterFilename = videoFilename.replace(/\.[^.]+$/, '') + '.jpg';
    return { dir, posterFilename, filePath: path.join(dir, posterFilename) };
}

// 列表：合并图片+视频，按生成时间倒序，支持类型筛选 + 分页
uploadServer.get('/media/generated/list', async (req: any, res: any) => {
    try {
        const type = (req.query.type as string) || 'all';
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
        const protocol = req.protocol;
        const host = req.get('host');

        const collect = (kind: 'image' | 'video') => {
            const dir = path.join(getUploadDir(), 'generated', GENERATED_SUBDIRS[kind]);
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).map((filename) => {
                const filePath = path.join(dir, filename);
                const stat = fs.statSync(filePath);
                return {
                    type: kind,
                    filename,
                    url: `${protocol}://${host}/uploads/generated/${GENERATED_SUBDIRS[kind]}/${filename}`,
                    size: stat.size,
                    createdAt: stat.birthtimeMs || stat.ctimeMs,
                };
            });
        };

        let items: any[] = [];
        if (type === 'all' || type === 'image') items = items.concat(collect('image'));
        if (type === 'all' || type === 'video') items = items.concat(collect('video'));
        items.sort((a, b) => b.createdAt - a.createdAt);

        const total = items.length;
        const start = (page - 1) * pageSize;
        const pageItems = items.slice(start, start + pageSize);

        // 只给当前这一页的视频生成/复用封面，避免一次性截全部视频拖慢接口
        await Promise.all(
            pageItems.filter((it) => it.type === 'video').map(async (it) => {
                const { dir, posterFilename, filePath } = posterPathFor(it.filename);
                try {
                    if (!fs.existsSync(filePath)) {
                        fs.mkdirSync(dir, { recursive: true });
                        const videoFilePath = path.join(getUploadDir(), 'generated', GENERATED_SUBDIRS.video, it.filename);
                        await extractPosterFrame(videoFilePath, filePath);
                    }
                    it.poster = `${protocol}://${host}/uploads/generated/${THUMB_SUBDIR}/${posterFilename}`;
                } catch {
                    // 截帧失败（文件损坏等）不影响列表返回，前端会回退到占位图标
                }
            })
        );

        res.send(success({ items: pageItems, total, page, pageSize }));
    } catch (e: any) {
        res.send(error500(`获取列表失败：${e.message}`));
    }
});

// 删除
uploadServer.delete('/media/generated/:kind/:filename', (req: any, res: any) => {
    try {
        const { kind, filename } = req.params;
        const subDir = GENERATED_SUBDIRS[kind];
        if (!subDir) return res.send(error500('非法类型'));
        const filePath = path.join(getUploadDir(), 'generated', subDir, filename);
        if (!fs.existsSync(filePath)) return res.send(error500('文件不存在'));
        fs.unlinkSync(filePath);
        if (kind === 'video') {
            const { filePath: posterFilePath } = posterPathFor(filename);
            if (fs.existsSync(posterFilePath)) fs.unlinkSync(posterFilePath);
        }
        res.send(success());
    } catch (e: any) {
        res.send(error500(`删除失败：${e.message}`));
    }
});

// 复制图片到系统剪贴板（走 Electron 主进程 clipboard，粘贴可直接用于微信/Word/画图等其他应用）
uploadServer.post('/media/generated/copy-image', (req: any, res: any) => {
    try {
        const { filename } = req.body || {};
        if (!filename) return res.send(error500('缺少文件名'));
        const filePath = path.join(getUploadDir(), 'generated', 'images', filename);
        if (!fs.existsSync(filePath)) return res.send(error500('文件不存在'));
        const { clipboard, nativeImage } = require('electron');
        const image = nativeImage.createFromPath(filePath);
        if (image.isEmpty()) return res.send(error500('图片读取失败'));
        clipboard.writeImage(image);
        res.send(success());
    } catch (e: any) {
        res.send(error500(`复制失败：${e.message}`));
    }
});

// 错误处理中间件
uploadServer.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.send(error500("文件大小超过限制 (最大 100MB)")) 
        }
    }
    res.send(error500("服务器内部错误")) 
});

// 健康检查
uploadServer.get('/', (req, res) => {
    res.json({
        message: '文件上传服务运行中',
        endpoints: {
            uploadImage: 'POST /upload/images',
            uploadVideo: 'POST /upload/videos',
            uploadAttachment: 'POST /upload/attachments',
            uploadMultiple: 'POST /upload/:type/multiple',
            getFile: 'GET /file/:type/:filename',
            deleteFile: 'DELETE /file/:type/:filename'
        }
    });
});
export default uploadServer
