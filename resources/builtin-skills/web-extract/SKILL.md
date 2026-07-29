---
name: web-extract
description: 浏览器自动化工具。当用户需要打开网页、与页面交互、填写表单、上传文件、截图、提取数据时使用。所有操作通过单一 browser 工具完成，参数 action 指定操作类型。
version: 1.0.3
builtin: true
---

# 浏览器自动化操作指南

## 调用格式（唯一工具：browser）

所有浏览器操作均通过 `browser({ action, ...参数 })` 完成：

| action | 必填参数 | 可选参数 | 示例 |
|--------|---------|---------|------|
| `openUrl` | `url` | — | `browser({ action:"openUrl", url:"https://baidu.com" })` |
| `state` | — | — | `browser({ action:"state" })` |
| `screenshot` | — | — | `browser({ action:"screenshot" })` |
| `click` | `index` | — | `browser({ action:"click", index:5 })` · 返回含 `newTab:true` 时表示已自动切换到新标签页 |
| `inputText` | `index`, `text` | — | `browser({ action:"inputText", index:3, text:"关键词" })` · 普通输入框和富文本/contenteditable 编辑器均支持，内部会自动清空原内容再输入，无需先手动全选 |
| `uploadFile` | `index`, `filePath` | — | `browser({ action:"uploadFile", index:5, filePath:"F:/a.png" })` · 给指定元素上传本地文件；若该元素是触发上传的按钮而非可见的 `<input type="file">`，会自动接管点击后弹出的系统文件选择框；多文件传路径数组 `filePath:["F:/a.png","F:/b.png"]` |
| `hover` | `index` | — | `browser({ action:"hover", index:9 })` · 把鼠标真实移动到该元素上触发 `:hover`，专用于"平时隐藏、只有悬浮到该行/卡片上才出现"的按钮（常见于列表/信息流的操作按钮） |
| `getText` | `index` | — | `browser({ action:"getText", index:7 })` · 提取单个元素的文本 |
| `getPageText` | — | — | `browser({ action:"getPageText" })` · 提取页面全部可见正文（过滤导航/脚本，优先取 article/main 区域，最多 8000 字符） |
| `scroll` | `direction` | — | `browser({ action:"scroll", direction:"down" })` |
| `keys` | `key` | — | `browser({ action:"keys", key:"Escape" })` |
| `wait` | — | `ms` | `browser({ action:"wait", ms:2000 })` |
| `back` | — | — | `browser({ action:"back" })` |
| `clearHighlight` | — | — | `browser({ action:"clearHighlight" })` · 清除 state 在页面上留下的所有彩色标注框 |

---

## 核心原则

1. **先定位再操作**：每次操作前通过 `state` 获取元素索引，不得猜测
0. **读内容用 getPageText，不用截图**：需要阅读页面正文（文章、搜索结果、详情页）时，优先调用 `getPageText`；`screenshot` 仅用于无法提取文本的特殊情况
2. **操作后必等待**：触发跳转或提交后立即调用 `wait`
3. **state 一次够用**：state 返回全部元素，避免重复调用
4. **截图是最后手段**：state 能定位时不截图，同一页面最多截图 **2 次**
5. **最大步骤限制**：单次任务总调用次数不超过 **20 次**，超过则报告进度并询问用户
6. **截图自动清除标注**：screenshot 在底层已自动移除高亮框，无需手动调用 clearHighlight
7. **任务结束必须清除标注**：任务完成后最后一步调用 `browser({ action:"clearHighlight" })`，还原页面供人工查看
8. **index 会因页面变化而错位，务必带 expectedText 核对**：index 是每次 `state` 重新扫描页面后临时分配的编号，只要两次 `state` 之间页面任意位置发生了变化（哪怕跟目标元素毫无关系，比如信息流懒加载了新内容、某个计数器多/少了一项），后续所有 index 都可能整体错位一位——不是目标元素变了，而是它在新一轮编号里排到了别的位置。对 `click`/`inputText`/`uploadFile`/`hover`，务必附带 `expectedText` 参数（该元素在最近一次 state/截图里看到的文字，比如按钮上写的字），系统会先核对当前该索引下的元素文字是否仍然一致，不一致会直接报错提示重新 `state`，而不是默默点到别的元素上；如果操作报错提示"与预期不符"，必须重新 `state` 拿最新索引，绝不能沿用旧索引重试

---

## 【方案 C】弹窗 / 广告自动处理

**每次 state 之后，先做干扰检测再继续任务：**

### 干扰检测关键词
```
关闭类：× ✕ ✗ 关闭 close dismiss skip 稍后 不了 拒绝 取消
广告类：广告 推广 sponsor 促销 限时 领取
授权类：Cookie 隐私 同意 accept 订阅 关注
```

### 处理优先级（依次尝试）
```
① 在 state 元素中搜索关闭词 → 找到则 browser({ action:"click", index:N })
② 未找到 → browser({ action:"keys", key:"Escape" })
③ Escape 无效（state 元素数未变化）→ browser({ action:"back" })
④ 仍无法关闭 → browser({ action:"screenshot" }) 截图，向用户说明情况，等待指示
```

### 常见场景速查
| 弹窗类型 | 识别特征 | 优先处理方式 |
|---------|---------|------------|
| 广告弹窗 | 含"广告""推广""活动" | 找 × 按钮点击 |
| Cookie 授权 | 含"Cookie""隐私""同意" | 找"拒绝"或"关闭"点击 |
| 订阅邮件 | 含"订阅""邮件" | Escape |
| 新标签广告页 | URL 含 ad / promo / click | browser({ action:"back" }) |
| 浏览器通知授权 | 系统弹窗"是否接受通知" | browser({ action:"keys", key:"Escape" }) |

---

## 【方案 E】验证码 / 登录 自动暂停（系统级能力，无需手动处理）

`state` 和 `getPageText` 会自动检测当前页面是否出现**验证码**或**登录表单**。检测到时，该次调用会自动暂停整个任务，等待用户在真实浏览器窗口中手动完成验证/登录，**这不需要模型做任何截图或询问动作**，直接调用 `state`/`getPageText` 即可，暂停和恢复由系统处理。

恢复后会出现两种情况，按返回内容处理：

- **返回的是最新页面状态**（正常的 state/getPageText 结果）：说明用户已手动处理完成，直接按新状态继续原计划任务，不要重新执行之前已完成的步骤。
- **返回的是"用户选择更换方式..."的文字提示**：说明用户不想等待处理，让你自行决定替代方案（比如换一个网址、换一个搜索入口、换一种能达成同样目的的路径），不要重复刚才触发验证码/登录的那个操作。

注意：整个任务的浏览器会话/已打开的标签页在暂停期间保持不变，恢复后无需重新 `openUrl`。

---

## 【方案 D】防死循环安全限制

### 重试规则
- 同一操作失败 → 最多重试 **2 次**，超过则停止并报告
- 重试前必须重新调用 `state` 获取最新索引，不得用缓存索引

### 页面卡死检测
```
连续 2 次 state 返回元素数量完全相同且无预期变化
→ browser({ action:"wait", ms:2000 })
→ 再次 state
→ 仍无变化 → 截图记录，报告用户当前状况
```

### 截图频率限制
- 同一页面截图不超过 **2 次**
- 截图后必须有实质性操作（click/input/scroll）才能再次截图

### 总步骤上限
- 单任务工具调用总次数 ≤ 20 次
- 达到 15 次时主动向用户汇报进度
- 达到 20 次时停止并说明已完成部分

---

## 【方案 B】操作结果验证

每次关键操作后，必须验证结果：

| 操作类型 | 验证方式 | 成功标志 | 失败处理 |
|---------|---------|---------|---------|
| 页面跳转 | state 检查元素变化 | 出现目标页面特征元素 | back → 重试或报告 |
| 新标签页跳转 | click 返回值含 `newTab:true` | 直接视为成功，无需 state 验证 | state 确认当前 URL 是否正确 |
| 表单提交 | 查找关键词 | 成功/感谢/确认/submitted | 截图记录，报告用户 |
| 搜索 | 检查结果数量 | state 中有多个结果元素 | 检查输入是否正确 |
| 点击按钮 | 对比前后元素数 | 元素数或文本发生变化 | 重新 state 后重试 |
| 数据提取 | getText 返回非空 | 有实质内容 | scroll 后重试 |

---

## 标准操作流程

### 流程一：搜索类任务
```
browser({ action:"openUrl", url:"https://www.baidu.com" })
browser({ action:"wait" })

# ① 弹窗检测
browser({ action:"state" })
# → 检查是否有干扰元素，有则按方案C处理

# ② 定位并搜索
browser({ action:"inputText", index:<搜索框索引>, text:"关键词" })
browser({ action:"keys", key:"Enter" })
browser({ action:"wait" })

# ③ 验证结果（方案B）
browser({ action:"state" })
# → 确认出现搜索结果元素（数量 > 0）
```

### 流程二：表单填写类任务
```
browser({ action:"openUrl", url:"目标URL" })
browser({ action:"wait" })
browser({ action:"state" })
# → 弹窗检测，有则处理

browser({ action:"inputText", index:<字段1>, text:"内容1" })
browser({ action:"inputText", index:<字段2>, text:"内容2" })

# 下拉框
browser({ action:"click", index:<下拉框索引> })
browser({ action:"state" })   # 获取展开后的选项
browser({ action:"click", index:<目标选项索引> })

browser({ action:"click", index:<提交按钮索引> })
browser({ action:"wait" })

# 验证提交结果（方案B）
browser({ action:"state" })
# → 查找"成功""感谢""确认"等关键词
```

### 流程三：数据提取类任务
```
browser({ action:"openUrl", url:"目标URL" })
browser({ action:"wait" })
browser({ action:"state" })
# → 弹窗检测

browser({ action:"getText", index:<目标元素索引> })

# 无限滚动：元素数不增加即到底
browser({ action:"scroll", direction:"down" })
browser({ action:"wait" })
browser({ action:"state" })
# → 若元素数 > 上次，继续提取；否则已到底
```

### 流程四：遭遇广告新标签页
```
# 点击后跳到广告页（URL 含 ad/promo）
browser({ action:"back" })
browser({ action:"wait" })
browser({ action:"state" })
# → 确认回到原页面后继续
```

### 流程六：点击链接正常打开新标签页
```
# click 返回 { newTab: true, url: "..." } 时，会话已自动切换到新 tab
browser({ action:"click", index:<链接索引> })
# → 若返回 newTab:true，直接继续操作，无需验证
browser({ action:"wait" })
browser({ action:"state" })
# → 在新 tab 上继续任务
```

### 流程五：元素定位策略（按优先级）
```
① browser({ action:"state" })     → 直接获取索引
  ↓ 索引不明确
② browser({ action:"screenshot" }) → 视觉辅助确认（最多2次）
  ↓ 元素不在视口
③ browser({ action:"scroll", direction:"down" }) → 滚动后重新 state
  ↓ 页面加载中
④ browser({ action:"wait", ms:2000 }) → 等待后重新 state
  ↓ 点击困难
⑤ browser({ action:"keys", key:"Enter" }) → 键盘代替点击
```

### 流程七：文件/图片上传任务
```
browser({ action:"openUrl", url:"目标URL" })
browser({ action:"wait" })
browser({ action:"state" })

# 场景A：state 结果里能看到 tag:"input", type:"file" 的元素 → 直接对它上传
browser({ action:"uploadFile", index:<文件输入框索引>, filePath:"F:/path/to/image.png" })

# 场景B：只看到一个"上传"/"选择文件"按钮，真实 input 被隐藏 → 直接对按钮调用，无需先 click
browser({ action:"uploadFile", index:<上传按钮索引>, filePath:"F:/path/to/image.png" })

# 多文件一次上传
browser({ action:"uploadFile", index:<上传按钮索引>, filePath:["F:/a.png","F:/b.png"] })

browser({ action:"wait" })
browser({ action:"state" })
# → 验证结果（方案B）：查找预览图/文件名等已上传的标志
```
**注意**：`filePath` 必须是本机磁盘上真实存在的绝对路径；要上传自己生成的内容需先落盘拿到本地路径，不能传网络链接或 base64。

### 流程八：点击"鼠标悬浮才出现"的按钮（列表/信息流常见）
```
browser({ action:"state" })
# → 该操作按钮平时不在 state 结果里，或者 state 里看到了但直接 click 无效/点错

# ① 先 hover 到按钮所在的整行/卡片，触发它显示出来
browser({ action:"hover", index:<行/卡片索引> })
browser({ action:"wait", ms:300 })   # 给 CSS 过渡动画留时间

# ② 重新 state，这时才能看到刚显示出来的按钮，拿到它此刻的真实索引
browser({ action:"state" })

# ③ 用 expectedText 核对后再点击，避免 index 因页面变化而错位点错
browser({ action:"click", index:<按钮索引>, expectedText:"使用" })
```
**不要**对着 state 里还没显示出来（或者上一轮 hover 之前）的旧索引直接 click，很容易点到别的元素或完全无反应。

---

## 常见错误处理

**元素点击无响应**
→ `wait` → 重新 `state` → 重试；2次失败则换 `keys({ key:"Enter" })`

**输入框无法清空**
→ `inputText` 已内置自动清空（含富文本编辑器），直接调用即可，不需要先手动 `Control+a`

**点击上传按钮没反应，或不确定该点哪个元素**
→ 不要用 `click` 去点上传按钮，直接对该按钮索引调用 `uploadFile`，会自动接管点击后弹出的系统文件选择框

**按钮平时看不到，只有鼠标悬浮到某一行/卡片才出现**
→ 按【流程八】处理：先 `hover` 该行/卡片 → `wait` 一下 → 重新 `state` 拿到这时才出现的按钮索引 → 带 `expectedText` 再 `click`

**点击/操作报错提示"当前元素是...与预期不符"，或者点了没反应像是点错了地方**
→ 说明 index 已经因为页面变化而错位（哪怕跟目标元素无关的地方发生了变化，后续所有 index 都可能整体错位一位），必须重新调用 `state` 拿最新索引，绝不能沿用之前步骤记住的旧 index 重试；之后的关键操作尽量带上 `expectedText` 提前拦截这种错位

**页面弹出广告遮挡**
→ 按【方案C】流程处理

**连续操作无效（页面卡住）**
→ 按【方案D】卡死检测流程处理

**索引失效（跳转/滚动后）**
→ 必须重新调用 `state`，不得复用旧索引
