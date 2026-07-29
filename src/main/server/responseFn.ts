export function success(data:any=[] ,message="成功"){
    return {code:200,message:message,data:data}
}
export function error500(message="操作失败",data=null){
    return {code:500,message:message,data}
}
export function error(code,message="操作失败",data=null){
    return {code:code,message:message,data}
}