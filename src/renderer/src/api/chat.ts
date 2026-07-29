import exctronAxios from '../config/axios';
// 创建会话
export function createSessionId(params: any) {
    return exctronAxios.get('/chat/createChatSessionId', params);
}
//查询会话列表 
export function sessionList(params: any) {
    return exctronAxios.get('/chat/sessionList',{params});
}
export function getSessionMessages(sessionId: any) {
    return exctronAxios.get(`/chat/sessions/${sessionId}/messages`);
}
//删除会话 
export function delSession(params:any){
    return exctronAxios.get('/chat/delChatSession',{params});
}
