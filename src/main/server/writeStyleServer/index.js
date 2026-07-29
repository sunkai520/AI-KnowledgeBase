// @ts-ignore
import {
  success,
  error500,
  error
} from "../responseFn"
import {
  formatDate,
} from "../../utils/common"
import {
  doc
} from "../../utils/document";
import {
  HumanMessage,
  SystemMessage,
} from "langchain";
import {
  getDB
} from "../../utils/getDb";
import { ModelFactory } from '../../model/modelFactory';
import {
  writePromt
} from "../../model/prompt"
import * as z from "zod";
const db = new Proxy({}, { get: (_, prop) => getDB().db[prop] });
const express = require('express');
const writeStyleServer = express.Router();

writeStyleServer.post('/add', async (req, res) => {
  const {
    type,
    content,
    url,
    filePaths
  } = req.body;
  const model = ModelFactory.getChatModel({ isNew: true })
  const Movie = z.object({
    title: z.string().describe("文章标题"),
    content: z.string().describe("100字以内的文章摘要")
  });
  const modelWithStructure = model.withStructuredOutput(Movie);
  let response = null;
  let originalContent = null
  //文件上传
  if (type == 1) {
    if (!filePaths || filePaths.length == 0) {
      res.send(error500('filePaths不能为空'));
      return
    }
    let dd = await Promise.all(filePaths.map(async path => {
      return new Promise(async (resolve, reject) => {
        try {
          let docObj = new doc({
            docPath: path.filePath,
            chunkSize: 15000,
          });
          let text = await docObj.loader.load();
          let str = ""
          text.forEach(t => {
            str += t.pageContent
          })
          originalContent = str;
          console.log(str)
          response = await modelWithStructure.invoke([new SystemMessage(writePromt), new HumanMessage(`${str}`)]);
          console.log(response);
          resolve({
            msd: "成功"
          })
        } catch (error) {
          reject(error)
        }

      })
    }))
  }
  //自定义内容
  if (type == 2) {
    response = await modelWithStructure.invoke([new SystemMessage(writePromt), new HumanMessage(`${content}`)]);
    console.log(response);
    originalContent = content
  }
  if (type == 3) {
    let docObj = new doc({
      docPath: url,
      chunkSize: 15000,
    });
    let text = await docObj.loader.load();
    let str = ""
    text.forEach(t => {
      str += t.pageContent
    })
    originalContent = str;
    response = await modelWithStructure.invoke([new SystemMessage(writePromt), new HumanMessage(`${str}`)]);
    console.log(response);
  }
  let stmt = db.prepare(`INSERT INTO articles(title,content,originalContent,updateTime,createTime) values(?,?,?,?,?)`);
  stmt.run(response.title, response.content, originalContent, formatDate(new Date().getTime()), formatDate(new Date().getTime()));
  res.send(success())
})
//分页获取列表
writeStyleServer.get('/list', (req, res) => {
  const {
    keyWord = "",
      page = 1,
      pageSize = 10,
  } = req.query;
  const pageNum = Math.max(1, Number(page));
  const sizeNum = Math.max(1, Number(pageSize));
  const offset = (pageNum - 1) * sizeNum;
  let sql = `SELECT * FROM articles 
    WHERE content LIKE ? 
    ORDER BY createTime DESC 
    LIMIT ? OFFSET ?`
  const params = [`%${keyWord}%`];
  const totalPrams = [`%${keyWord}%`];
  params.push(sizeNum, offset);
  let stmt = db.prepare(sql);
  const list = stmt.all(...params);
  let totalSql = `SELECT COUNT(*) AS total FROM texts WHERE content LIKE ?`

  const totalsmt = db.prepare(totalSql);
  const {
    total
  } = totalsmt.get(...totalPrams);
  res.send(success({
    list,
    page: pageNum,
    pageSize: sizeNum,
    total
  }))
})
//删除
writeStyleServer.get('/delete', (req, res) => {
  const {
    id
  } = req.query;
  if (!id) {
    res.send(error500('id不能为空'));
  }
  let stmt = db.prepare(`DELETE FROM articles WHERE id = ?`);
  stmt.run(id);
  res.send(success())
})
export default writeStyleServer
