import exctronAxios from '../config/axios';

// 从参考 .docx 提取标题/节标题/正文的字体、字号、缩进、行距
export function parseDocStyleTemplate(filePath: string, fileName?: string) {
    return exctronAxios.post('/doc/parseStyleTemplate', { filePath, fileName });
}

// 生成 Word/PDF 文档;options.customTemplate 可传 parseDocStyleTemplate 的返回结果,复刻参考文档格式
export function generateDoc(params: any) {
    return exctronAxios.post('/doc/generate', params);
}
