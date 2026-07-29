---
name: browser-sk
description: 进行 Web 测试、表单填写、截图和数据提取的浏览器自动化工具。当用户需要浏览网站、与网页交互、填写表单、截取屏幕截图或从网页提取信息时使用。
---

# 浏览器自动化操作指南

## 工具说明

| 工具 | 说明 | 典型场景 |
|------|------|----------|
| `browser_openUrl` | 打开指定网址 | 任务起点，打开目标页面 |
| `browser_state` | 获取页面所有可交互元素及其索引编号 | 定位元素的首选方式 |
| `browser_screenshot` | 截取当前页面截图 | state 索引不明确时辅助视觉定位 |
| `browser_click` | 点击指定索引的元素 | 点击按钮、链接、下拉选项 |
| `browser_inputText` | 在指定索引的元素中输入文本，普通输入框和富文本/contenteditable 编辑器都支持，不需要额外处理 | 填写搜索框、表单字段、富文本编辑区 |
| `browser_uploadFile` | 给指定索引的元素上传本地文件（图片/文档等），传 `filePath` 为本地绝对路径，多文件传路径数组 | 上传头像/附件、发图片消息 |
| `browser_getText` | 获取指定索引元素的文本内容 | 提取页面数据、读取结果 |
| `browser_scroll` | 向上或向下滚动页面 | 加载更多内容、查找视口外的元素 |
| `browser_keys` | 模拟键盘按键 | 回车提交、Tab 切换焦点、Escape 关闭弹窗 |
| `browser_wait` | 等待页面加载或动画完成 | 点击跳转后、表单提交后 |
| `browser_back` | 返回上一页 | 需要回退到前一个页面时 |

---

## 核心原则

1. **先定位，再操作**：每次操作前必须通过 `browser_state` 或 `browser_screenshot` 确认元素索引，不得猜测索引值
2. **操作后等待**：凡是会触发页面跳转或加载的操作（点击链接、提交表单）后必须调用 `browser_wait`
3. **一次 state 够用**：`browser_state` 会返回页面全部可交互元素，通常一次调用即可获取所有需要的索引，避免重复调用
4. **截图是辅助**：`browser_screenshot` 仅在 `browser_state` 返回的索引难以判断时使用，不要每步都截图

---

## 元素定位策略（按优先级顺序）

```
① browser_state() 直接获取索引
       ↓ 索引不明确
② browser_screenshot() 截图视觉确认
       ↓ 元素不在当前视口
③ browser_scroll() 滚动后重新 browser_state()
       ↓ 页面仍在加载
④ browser_wait() 等待后重新 browser_state()
       ↓ 点击类操作定位困难
⑤ browser_keys({ key: "Enter" }) 用快捷键代替点击
```

---

## 标准操作流程

### 流程一：搜索类任务（以百度搜索为例）

```
# 步骤 1：打开目标网站
browser_openUrl("https://www.baidu.com")
browser_wait()

# 步骤 2：获取页面元素索引（搜索框 + 搜索按钮一次获取）
browser_state()
# 若元素索引不确定，截图辅助判断
browser_screenshot()

# 步骤 3：在搜索框输入内容
browser_inputText({ index: <搜索框索引>, text: "搜索关键词" })

# 步骤 4：提交搜索
# 方案A：点击搜索按钮
browser_click({ index: <搜索按钮索引> })
# 方案B（备选）：直接回车
browser_keys({ key: "Enter" })
browser_wait()

# 步骤 5：获取搜索结果
browser_state()
# 若结果需要滚动查看
browser_scroll({ direction: "down" })
browser_state()
```

### 流程二：表单填写类任务

```
# 步骤 1：打开表单页面
browser_openUrl("目标URL")
browser_wait()

# 步骤 2：获取表单所有字段索引
browser_state()

# 步骤 3：依次填写各字段
browser_inputText({ index: <字段1索引>, text: "内容1" })
browser_inputText({ index: <字段2索引>, text: "内容2" })

# 下拉选择框
browser_click({ index: <下拉框索引> })
browser_state()  # 获取展开后的选项索引
browser_click({ index: <目标选项索引> })

# 步骤 4：提交表单
browser_click({ index: <提交按钮索引> })
browser_wait()

# 步骤 5：确认提交结果
browser_screenshot()
```

### 流程三：数据提取类任务

```
# 步骤 1：打开目标页面
browser_openUrl("目标URL")
browser_wait()

# 步骤 2：定位目标内容
browser_state()

# 步骤 3：提取文本
browser_getText({ index: <目标元素索引> })

# 若需要提取多处内容，滚动后继续提取
browser_scroll({ direction: "down" })
browser_state()
browser_getText({ index: <下一个目标索引> })
```

### 流程四：文件/图片上传任务

```
# 步骤 1：打开目标页面并定位上传入口
browser_openUrl("目标URL")
browser_wait()
browser_state()

# 步骤 2：上传文件
# 场景A：页面上能看到一个真实的 <input type="file">（state 结果里 tag=input, type=file）
browser_uploadFile({ index: <文件输入框索引>, filePath: "F:/path/to/image.png" })
# 场景B：需要先点一个"上传"/"选择文件"按钮才会弹出系统选择框——
# 直接对这个按钮调用 uploadFile 即可，会自动接管弹窗，无需先 click 再处理系统对话框
browser_uploadFile({ index: <上传按钮索引>, filePath: "F:/path/to/image.png" })
# 多文件一次上传，filePath 传数组
browser_uploadFile({ index: <上传按钮索引>, filePath: ["F:/a.png", "F:/b.png"] })

# 步骤 3：确认上传成功
browser_wait()
browser_screenshot()
```

**注意**：`filePath` 必须是本机磁盘上真实存在的绝对路径。如果要上传的是自己生成的内容（如生成的图片/文档），需要先把它保存成本地文件拿到路径，再传给 `browser_uploadFile`，不能直接传网络链接或 base64。

### 流程五：多页面导航任务

```
# 步骤 1：打开起始页面
browser_openUrl("起始URL")
browser_wait()

# 步骤 2：点击进入子页面
browser_state()
browser_click({ index: <链接索引> })
browser_wait()

# 步骤 3：在子页面执行操作
browser_state()
# ... 执行操作 ...

# 步骤 4：返回上一页
browser_back()
browser_wait()
browser_state()
```

---

## 常见问题处理

**元素点击无响应**
→ `browser_wait()` 等待后重新 `browser_state()` 确认索引，再尝试 `browser_keys({ key: "Enter" })`

**页面有弹窗遮挡**
→ `browser_keys({ key: "Escape" })` 尝试关闭，或 `browser_state()` 找到关闭按钮后 `browser_click`

**动态加载内容未显示**
→ `browser_scroll({ direction: "down" })` 触发懒加载，配合 `browser_wait()` 等待渲染完成

**输入框内容需要清空后重新输入**
→ `browser_inputText` 内部已自动全选清空（含富文本编辑器），直接调用即可，无需手动先 `Control+a`

**富文本编辑器输入无效或报错**
→ 先 `browser_state()` 重新获取最新索引再 `browser_inputText`；富文本/contenteditable 编辑区已内置支持，若仍失败大概率是索引过期（页面结构变化），不是不支持该类型编辑器

**点击上传按钮后没有反应，或不确定该点谁**
→ 不要用 `browser_click` 去点上传按钮，直接对该按钮索引调用 `browser_uploadFile`，会自动处理点击后弹出的系统文件选择框

**页面加载缓慢**
→ 增加 `browser_wait()` 调用次数，每次操作后都等待再继续
