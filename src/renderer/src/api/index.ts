import exctronAxios from '../config/axios';
// 登录
export function getlogin(params: any) {
  return exctronAxios.post('/login', params);
}

export function uploadImage(params:any){
    return exctronAxios.post('/upload/images',params,{
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
}
export function uploadVideo(params:any){
  return exctronAxios.post('/upload/videos',params,{
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
}
export function uploadAttachment(params:any){
  return exctronAxios.post('/upload/attachments',params,{
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
}

export function delUpload(type,filename){
  return exctronAxios.delete(`/file/${type}/${filename}`);
}

// 创作管理：AI 生成的图片/视频
export function listGeneratedMedia(params: { type?: string; page?: number; pageSize?: number }) {
  return exctronAxios.get('/media/generated/list', { params });
}
export function deleteGeneratedMedia(kind: 'image' | 'video', filename: string) {
  return exctronAxios.delete(`/media/generated/${kind}/${filename}`);
}
export function copyGeneratedImage(filename: string) {
  return exctronAxios.post('/media/generated/copy-image', { filename });
}
