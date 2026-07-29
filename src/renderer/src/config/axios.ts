import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ElMessage } from "element-plus";

const exctronAxios = axios.create({
    baseURL: 'http://localhost:5120',
    timeout: 5*60 * 1000,
    headers: {
        'Content-Type': 'application/json'
    }
})
//请求打断函数
const requestConfig = (config: AxiosRequestConfig) => {
    let token = localStorage.getItem('token');
    if (token) {
        // @ts-ignore
        config.headers['Authorization'] = `${token}`;
    }
    return config;
};
const requestError = (error: AxiosError) => {
    box("接口请求失败(请检查电脑网络)", "error")
    return Promise.reject(error);
};
//响应打断函数
const responseConfig = (response: AxiosResponse) => {
    if (response.status == 200) {
        if (response.data.code == 200 || response.data.code == 777) {
            return response.data;
        } else if (response.data.code == 401) {
            box("身份验证失效!", "warning")
            // exitOut();
            return Promise.reject(`身份验证失效,请重新登录!`)
        } else {
            box(`${response.data.message || response.statusText}`, "warning")
            return Promise.reject(`接口错误:${response.data.message || response.statusText}`)
        }
    } else {
        box(`${response.data.message || response.statusText}`, "warning")
        return Promise.reject(`服务器类错误:${response.data.message || response.statusText}`)
    }

};
const responseError = (error: AxiosError) => {
    return Promise.reject(error)
};
let timer: any = null
//使用防抖 防止多次请求 页面一直提示
function box(msg, type) {
    if (timer) {
        clearTimeout(timer)
        timer = null
    }
    timer = setTimeout(() => {
        ElMessage({
            type: type,
            message: msg,
            customClass: "ky_messageTip",
            dangerouslyUseHTMLString: true
        });
    }, 500)
}
//请求前
// @ts-ignore
exctronAxios.interceptors.request.use(requestConfig, requestError);
//响应
exctronAxios.interceptors.response.use(responseConfig, responseError);

export default exctronAxios