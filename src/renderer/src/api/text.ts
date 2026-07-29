import exctronAxios from '../config/axios';
// 创建分类
export function add(params: any) {
    return exctronAxios.post('/text/add', params);
}
//删除分类
export function del(params: any) {
    return exctronAxios.get('/text/del', {params});
}
//查询列表
export function list(params: any) {
    return exctronAxios.get('/text/list', {params});
}
//添加文章
export function saveText(params:any){
    return exctronAxios.post('/text/saveText',params);
}
//获取文章
export function textList(params: any) {
    return exctronAxios.get('/text/textList', {params});
}

export function delText(params: any) {
    return exctronAxios.get('/text/delText', {params});
}
//获取文章详情
export function textDetail(id: any) {
    return exctronAxios.get(`/text/textDetail/${id}`);
}
//更新
export function updateText(params: any) {
    return exctronAxios.put(`/text/textDetail/${params.id}`, params);
}

export function listWritingChatSessions(params: any) {
    return exctronAxios.get('/text/writingChat/sessions', {params});
}

export function createWritingChatSession(params: any) {
    return exctronAxios.post('/text/writingChat/sessions', params);
}

export function getWritingChatMessages(sessionId: any) {
    return exctronAxios.get(`/text/writingChat/sessions/${sessionId}/messages`);
}

export function deleteWritingChatSession(sessionId: any) {
    return exctronAxios.delete(`/text/writingChat/sessions/${sessionId}`);
}

export function createWritingFeedback(params: any) {
    return exctronAxios.post('/text/writingFeedback', params);
}
