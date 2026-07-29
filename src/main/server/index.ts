// @ts-ignore
// import DB from "../utils/DBConnect"
import uploadServer from "./uploadServer/index"
// @ts-ignore
import chat from "./chatServer/index"
import textServer from "./textServer/index"
import writeStyleServer from "./writeStyleServer/profileRouterV2"
import docServer from "./docServer/index"  // 新增
import deepChat from "./deepAgentServer/index"
//@ts-ignore
// import orcServer from "./orcServer/orc"
const { BrowserWindow } = require('electron')
export function initServer() {
    const express = require('express');
    const bodyParser = require('body-parser');
    const cors = require('cors');
    const server = express();
    // => 定义一个最简单的中间件函数
    const intercept = function (req, res, next) {
        // console.log('这是中间件函数')
        // => 把流转关系，转交给下一个中间件或路由
        next()
    }
    // 启用 CORS
    const corsOptions = {
        //允许跨域请求配置
        origin: function (origin, callback) {
            // const allowedOrigins = ['http://127.0.0.1', 'http://localhost:5174'];
            // if (allowedOrigins.includes(origin)) {
            callback(null, true);
            // } else {
            //     callback(new Error('Not allowed by CORS'));
            // }
        }
    }
    server.use(cors(corsOptions));
    // 解析 JSON 请求体
    // limit 调大到 10mb：Skill 一键导入（zip/远程目录）会把文件内容以 base64 塞进 JSON body，
    // 默认 100kb 太小，即便压缩包本身没超过业务层 2MB 上限也会先被 body-parser 拒绝
    server.use(bodyParser.json({ limit: '10mb' }));
    server.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
    // => 全局生效的中间件
    server.use(intercept)
    //上传
    server.use(uploadServer)
    //文章
    server.use("/text", textServer)
    //ai
    server.use("/chat", chat)
    server.use("/deepAgent", deepChat)
    server.use("/writeStyle", writeStyleServer)
     // 新增文档生成路由
     server.use("/doc", docServer)
    // 启动服务器并监听端口（根据需要更改端口号）
    let httpserver = server.listen(5120, () => {
        console.log('Server started on port 5120,http://localhost:5120/');
    });
    return httpserver;
}
