<template>
  <div class="page-wrap">
    <div class="config-card glass-card">
      <div class="card-top-bar"></div>
      <div class="card-decoration"></div>

      <!-- 顶部：标题 + 一级切换 -->
      <div class="card-head">
        <span class="card-title">模型配置</span>
        <div class="mode-tabs">
          <div :class="['mode-tab', { active: mode === 'assistant' }]" @click="mode = 'assistant'">AI 助手</div>
          <div :class="['mode-tab', { active: mode === 'agent' }]" @click="switchToAgent">AI 超级员工</div>
        </div>
      </div>

      <div class="card-divider"></div>

      <!-- ═══════════ AI 助手 ═══════════ -->
      <div v-if="mode === 'assistant'" class="assistant-wrap">
        <el-tabs v-model="activeType" class="model-tabs dark-tabs">
          <el-tab-pane label="聊天模型" name="chat" />
          <el-tab-pane label="向量化模型" name="embedding" />
        </el-tabs>

        <el-form label-width="90px" size="default" class="dark-form" style="max-width:560px;margin:0 auto;padding-top:8px">
          <el-form-item label="厂商">
            <el-select v-model="currentModel.provider" placeholder="选择厂商" style="width:100%" popper-class="dark-select-popper" @change="onProviderChange">
              <el-option v-for="p in presets" :key="p.id" :label="p.label" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="currentApiKey" show-password clearable placeholder="sk-..." :disabled="!currentModel.provider" @blur="fetchModelListFor(activeType, { silent: true })" />
            <div class="tip">同一厂商的 API Key 在所有模型间共享，修改一处即全部生效</div>
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="currentBaseUrl" clearable placeholder="https://..." :disabled="!currentModel.provider" @blur="fetchModelListFor(activeType, { silent: true })" />
          </el-form-item>
          <el-form-item label="模型名称">
            <div class="model-select-row">
              <el-select
                v-model="currentModel.modelName"
                filterable
                allow-create
                default-first-option
                clearable
                :placeholder="currentPreset?.hint || '选择或输入模型名称'"
                style="flex:1"
                popper-class="dark-select-popper"
              >
                <el-option v-for="m in currentModelOptions" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button :loading="loadingModelOptions" :disabled="!currentModel.provider || !currentBaseUrl" title="从厂商拉取模型列表" @click="refreshModelOptions">
                <el-icon><Refresh /></el-icon>
              </el-button>
            </div>
            <div class="tip" v-if="currentPreset?.hint">{{ currentPreset.hint }}</div>
          </el-form-item>
          <el-form-item label="Temperature" v-if="activeType !== 'embedding'">
            <div class="slider-row">
              <el-slider v-model="currentModel.temperature" :min="0" :max="2" :step="0.1" style="flex:1" />
              <span class="slider-val">{{ currentModel.temperature }}</span>
            </div>
          </el-form-item>
          <el-form-item label="流式输出" v-if="activeType === 'chat'">
            <el-switch v-model="currentModel.streaming" />
          </el-form-item>
          <el-form-item label="原生联网搜索" v-if="activeType === 'chat' && nativeSearchDetected">
            <el-switch v-model="currentModel.nativeSearch" />
            <div class="tip">
              识别到当前模型名「{{ currentModel.modelName }}」属于 {{ nativeSearchDetected }} 系列。开启后，联网搜索优先用模型厂商自带的搜索工具，而不是本应用自带的搜索。
            </div>
          </el-form-item>
          <el-form-item label="推理强度" v-if="activeType === 'chat' && nativeSearchDetected">
            <el-select v-model="currentModel.reasoningEffort" style="width:100%" popper-class="dark-select-popper">
              <el-option label="低" value="low" />
              <el-option label="中" value="medium" />
              <el-option label="高" value="high" />
            </el-select>
            <div class="tip">仅对支持推理的模型生效，非推理模型会忽略此参数。强度越高，思考越深，耗时和成本也越高。</div>
          </el-form-item>
          <el-form-item label="上下文窗口" v-if="activeType === 'chat'">
            <el-input-number v-model="currentModel.contextWindow" :min="4000" :max="2000000" :step="1000" style="width:100%" controls-position="right" />
            <div class="tip">该模型支持的最大输入 token 数，请查看厂商文档确认，用于动态计算长期记忆压缩阈值。宁可填小不要填大，填大了起不到保护作用</div>
          </el-form-item>
          <template v-if="activeType === 'embedding'">
            <el-form-item label="Dimensions">
              <el-input-number v-model="currentModel.dimensions" :min="128" :max="4096" />
              <div class="tip warn-tip">
                修改 Dimensions 会改变向量维度。旧知识库如果已经按当前维度完成向量化，修改后可能导致历史知识库检索失效，需要重新重建知识库向量。
              </div>
            </el-form-item>
            <el-form-item label="Batch Size">
              <el-input-number v-model="currentModel.batchSize" :min="1" :max="100" />
            </el-form-item>
          </template>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="handleSave">保存配置</el-button>
            <el-button @click="handleReset">恢复默认</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- ═══════════ AI 超级员工 ═══════════ -->
      <div v-else class="agent-wrap dark-form">

        <!-- 主模型 -->
        <div class="agent-block">
          <div class="block-title"><span class="block-dot"></span>主模型</div>
          <el-form label-width="90px" size="default">
            <el-form-item label="厂商">
              <el-select v-model="form.agent.provider" style="width:100%" popper-class="dark-select-popper" @change="onAgentProviderChange">
                <el-option v-for="p in presets" :key="p.id" :label="p.label" :value="p.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="agentApiKey" show-password clearable placeholder="sk-..." :disabled="!form.agent.provider" @blur="fetchAgentModelList({ silent: true })" />
              <div class="tip">同一厂商的 API Key 在所有模型间共享，修改一处即全部生效</div>
            </el-form-item>
            <el-form-item label="Base URL">
              <el-input v-model="agentBaseUrl" clearable placeholder="https://..." :disabled="!form.agent.provider" @blur="fetchAgentModelList({ silent: true })" />
            </el-form-item>
            <el-form-item label="模型名称">
              <div class="model-select-row">
                <el-select
                  v-model="form.agent.modelName"
                  filterable
                  allow-create
                  default-first-option
                  clearable
                  placeholder="选择或输入模型名称，例：deepseek-v3.2"
                  style="flex:1"
                  popper-class="dark-select-popper"
                >
                  <el-option v-for="m in agentModelOptions" :key="m" :label="m" :value="m" />
                </el-select>
                <el-button :loading="loadingAgentModelOptions" :disabled="!form.agent.provider || !agentBaseUrl" title="从厂商拉取模型列表" @click="refreshAgentModelOptions">
                  <el-icon><Refresh /></el-icon>
                </el-button>
              </div>
            </el-form-item>
            <el-form-item label="Temperature">
              <div class="slider-row">
                <el-slider v-model="form.agent.temperature" :min="0" :max="2" :step="0.1" style="flex:1" />
                <span class="slider-val">{{ form.agent.temperature }}</span>
              </div>
            </el-form-item>
            <el-form-item label="上下文窗口">
              <el-input-number v-model="form.agent.contextWindow" :min="4000" :max="2000000" :step="1000" style="width:100%" controls-position="right" />
              <div class="tip">该模型支持的最大输入 token 数，请查看厂商文档确认，用于压缩摘要触发阈值和单轮工具输出清理兜底。宁可填小不要填大</div>
            </el-form-item>
          </el-form>
        </div>

        <!-- 媒体生成模型 -->
        <div class="agent-block">
          <div class="block-title">
            <span class="block-dot"></span>媒体生成模型
            <span class="block-tip">文生图 / 图生视频，供 AI 员工自动规划分镜、生成素材并拼接成片时调用</span>
          </div>
          <el-form label-width="120px" size="default">
            <el-form-item label="厂商">
              <el-select v-model="form.media.provider" style="width:100%" disabled>
                <el-option label="阿里云百炼 (通义万相)" value="alibaba" />
              </el-select>
              <div class="tip">复用上方「主模型」厂商里阿里云百炼的 API Key，请确保已填写</div>
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="form.providers.alibaba.apiKey" show-password clearable placeholder="sk-..." />
            </el-form-item>
            <el-form-item label="文生图模型">
              <el-select
                v-model="form.media.imageModel"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="选择或输入模型名称，例：wanx2.1-t2i-turbo"
                style="width:100%"
                popper-class="dark-select-popper"
              >
                <el-option v-for="m in imageModelOptions" :key="m" :label="m" :value="m" />
              </el-select>
              <div class="tip">通义万相走独立的合成任务接口，没有可查询的模型列表接口，以上仅为常见型号，也可直接输入其他型号</div>
            </el-form-item>
            <el-form-item label="图生视频模型">
              <el-select
                v-model="form.media.videoModel"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="选择或输入模型名称，例：wan2.6-i2v-flash"
                style="width:100%"
                popper-class="dark-select-popper"
              >
                <el-option v-for="m in videoModelOptions" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <!-- 权限 -->
        <div class="agent-block">
          <div class="block-title"><span class="block-dot"></span>权限</div>
          <el-form label-width="120px" size="default">
            <el-form-item label="执行系统命令">
              <el-switch v-model="form.agentPermissions.enableShellExecute" active-text="允许" inactive-text="禁止" />
              <div class="tip warn-tip">开启后 AI 员工可执行 shell 命令，命令仅限在当前会话选定的工作目录内执行（对话页可指定/更改）</div>
            </el-form-item>
          </el-form>
        </div>

        <!-- Skills 库 -->
        <div class="agent-block">
          <div class="block-title">
            <span class="block-dot"></span>Skills 库
            <span class="block-tip">存放于 数据目录/skills/ 下，每个子目录为一个 Skill</span>
          </div>

          <div class="skill-list" v-loading="loadingSkills">
            <div v-for="sk in skills" :key="sk.name" class="skill-card">
              <!-- 头部：名称 + 操作 -->
              <div class="skill-header">
                <div class="skill-left">
                  <el-switch v-model="sk.enabled" @change="(v) => toggleSkillEnabled(sk, v)" />
                  <div class="skill-info">
                    <div class="skill-name-row">
                      <span class="skill-name">{{ sk.displayName || sk.name }}</span>
                      <el-tag v-if="sk.isBuiltin" size="small" effect="plain" class="builtin-tag">内置</el-tag>
                      <el-tag v-if="sk.author === 'agent'" size="small" type="warning" effect="plain">🤖 自学</el-tag>
                      <el-tag v-if="sk.imported" size="small" type="info" effect="plain">导入</el-tag>
                      <el-tag v-if="sk.riskFlags?.length" size="small" type="danger" effect="plain">有风险提示</el-tag>
                    </div>
                    <span class="skill-dir">{{ sk.name }}/</span>
                  </div>
                </div>
                <div class="skill-actions">
                  <el-button text size="small" @click="openSkillEditor(sk)">
                    <el-icon><Edit /></el-icon>编辑
                  </el-button>
                  <el-button v-if="!sk.isBuiltin" text size="small" @click="handleDeleteSkill(sk)">
                    <el-icon color="#ef4444"><Delete /></el-icon>
                  </el-button>
                </div>
              </div>
              <!-- 描述 -->
              <div class="skill-desc" v-if="sk.description">{{ sk.description }}</div>
            </div>

            <el-empty v-if="!loadingSkills && skills.length === 0"
              description="暂无 Skills，点击下方创建第一个" :image-size="50" />
          </div>

          <el-button class="add-btn" @click="openCreateSkill">
            <el-icon><Plus /></el-icon>创建新 Skill
          </el-button>
        </div>

        <!-- 保存 -->
        <div class="agent-block" style="border-bottom:none;padding-bottom:4px">
          <el-button type="primary" :loading="saving" @click="handleSave">保存配置</el-button>
          <el-button @click="handleReset">恢复默认</el-button>
        </div>
      </div>
    </div>

    <!-- ── Skill 编辑器 / 导入 Dialog ── -->
    <el-dialog v-model="skillEditorVisible"
      :title="isCreatingSkill ? '创建 / 导入 Skill' : `编辑 Skill：${editingSkillForm.name}`"
      width="720px" class="neon-dialog skill-editor-dialog" destroy-on-close align-center>

      <div class="skill-editor">
        <!-- 仅新建时可选导入方式，编辑已有 Skill 不涉及 -->
        <el-radio-group v-if="isCreatingSkill" v-model="importMode" class="import-mode-group" @change="resetImportState">
          <el-radio-button label="custom">自定义</el-radio-button>
          <el-radio-button label="zip">导入 zip</el-radio-button>
          <el-radio-button label="folder">导入文件夹</el-radio-button>
          <!-- GitHub API 未认证请求每小时限 60 次，代理出口 IP 常被共用导致更快耗尽，体验不稳定，暂时隐藏 -->
          <!-- <el-radio-button label="url">导入网址</el-radio-button> -->
        </el-radio-group>

        <!-- 自定义：目录名 + SKILL.md 编辑器（原有流程） -->
        <template v-if="!isCreatingSkill || importMode === 'custom'">
          <el-form v-if="isCreatingSkill" label-width="80px" size="default" class="dark-form dir-form">
            <el-form-item label="目录名">
              <el-input v-model="editingSkillForm.name" placeholder="小写字母/数字/连字符，如 browser-auto" />
              <div class="tip">创建后不可修改，建议用英文</div>
            </el-form-item>
          </el-form>

          <div class="editor-label">
            SKILL.md 内容
            <span class="editor-hint">frontmatter 中的 description 字段是 Agent 判断是否调用此 Skill 的依据，请写清楚</span>
          </div>
          <el-input
            v-model="editingSkillForm.rawContent"
            type="textarea"
            :rows="isCreatingSkill ? 16 : 22"
            class="raw-editor"
            resize="none"
          />
        </template>

        <!-- 导入 zip -->
        <template v-else-if="importMode === 'zip'">
          <div class="import-source-row">
            <input ref="zipInputRef" type="file" accept=".zip" class="hidden-file-input" @change="handleZipFileChange" />
            <el-button @click="zipInputRef?.click()">选择 zip 文件</el-button>
            <span class="import-file-name" v-if="importFileName">{{ importFileName }}</span>
          </div>
          <div class="tip">zip 内需包含 SKILL.md（可在压缩包根目录，或唯一的顶层文件夹下）</div>
        </template>

        <!-- 导入文件夹 -->
        <template v-else-if="importMode === 'folder'">
          <div class="import-source-row">
            <el-button :loading="previewLoading" @click="handlePickImportFolder">选择文件夹</el-button>
            <span class="import-file-name" v-if="importSourceDirPath">{{ importSourceDirPath }}</span>
          </div>
          <div class="tip">文件夹内需包含 SKILL.md（可直接在选中目录下，或唯一的子文件夹下）</div>
        </template>

        <!-- 导入网址 -->
        <template v-else-if="importMode === 'url'">
          <div class="import-source-row">
            <el-input v-model="importUrl" placeholder="GitHub 仓库/子目录链接，或 SKILL.md 原始文件链接" />
            <el-button type="primary" :loading="previewLoading" @click="handleFetchPreview">获取预览</el-button>
          </div>
          <div class="tip">例：https://github.com/owner/repo/tree/main/某个skill目录</div>
        </template>

        <!-- 导入预览卡片（zip / url 共用） -->
        <div v-if="isCreatingSkill && importMode !== 'custom' && importPreview" class="import-preview-card">
          <div class="preview-header">
            <span class="preview-name">{{ importPreview.displayName || "（未命名）" }}</span>
            <el-tag v-if="importPreview.version" size="small" effect="plain">v{{ importPreview.version }}</el-tag>
            <el-tag v-if="importPreview.hasScripts" size="small" type="warning" effect="plain">含可执行脚本</el-tag>
            <el-tag v-if="importPreview.riskFlags?.length" size="small" type="danger" effect="plain">
              风险提示 × {{ importPreview.riskFlags.length }}
            </el-tag>
          </div>
          <div class="preview-desc">{{ importPreview.description }}</div>

          <div v-if="importPreview.riskFlags?.length" class="preview-risk-box">
            <div class="preview-risk-title">⚠ 安全提示，请确认来源可信后再启用：</div>
            <ul>
              <li v-for="(f, i) in importPreview.riskFlags" :key="i">{{ f }}</li>
            </ul>
          </div>

          <div class="preview-files">
            <div class="preview-files-title">文件列表（{{ importPreview.fileList.length }}）</div>
            <div class="preview-file-row" v-for="f in importPreview.fileList" :key="f.path">
              <span :class="['file-path', { 'is-script': isScriptPath(f.path) }]">{{ f.path }}</span>
              <span class="file-size">{{ (f.size / 1024).toFixed(1) }}KB</span>
            </div>
          </div>

          <el-form label-width="80px" size="default" class="dark-form dir-form">
            <el-form-item label="目录名">
              <el-input v-model="importDirName" placeholder="小写字母/数字/连字符" />
              <div class="tip">导入后默认禁用，请查看内容后手动启用</div>
            </el-form-item>
          </el-form>
        </div>
      </div>

      <template #footer>
        <el-button class="cancel-btn" @click="skillEditorVisible = false">取消</el-button>
        <el-button v-if="!isCreatingSkill || importMode === 'custom'" class="confirm-btn" type="primary" :loading="savingSkill" @click="handleSaveSkill">保存</el-button>
        <el-button v-else class="confirm-btn" type="primary" :disabled="!importPreview" :loading="importing" @click="handleConfirmImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Edit, Delete, Plus, Refresh } from "@element-plus/icons-vue";
import router from "../../../router";
import {
  getAgentSkills, updateSkillEnabled, createSkill,
  getSkillContent, saveSkillContent, deleteSkill,
  previewSkillImport, confirmSkillImport,
} from "@renderer/api/agent.ts";


// ── 厂商预设 ──────────────────────────────────────────────────────────────
const presets = [
  { id: "alibaba",     label: "阿里云百炼 (Qwen)",      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", hint: "如 qwen-plus、qwen-vl-plus、text-embedding-v4" },
  { id: "deepseek",   label: "DeepSeek",               baseUrl: "https://api.deepseek.com/v1",                        hint: "如 deepseek-v3、deepseek-chat" },
  { id: "openai",     label: "OpenAI",                 baseUrl: "https://api.openai.com/v1",                          hint: "如 gpt-4o、text-embedding-3-small" },
  { id: "moonshot",   label: "月之暗面 (Moonshot)",    baseUrl: "https://api.moonshot.cn/v1",                        hint: "如 moonshot-v1-8k" },
  { id: "zhipu",      label: "智谱 (GLM)",              baseUrl: "https://open.bigmodel.cn/api/paas/v4",              hint: "如 glm-4、embedding-3" },
  { id: "siliconflow", label: "硅基流动 (SiliconFlow)", baseUrl: "https://api.siliconflow.cn/v1",                     hint: "如 deepseek-ai/DeepSeek-V3、Qwen/Qwen2.5-72B-Instruct" },
  { id: "xkapi",     label: "自建",           baseUrl: "http://localhost:8080/v1",                           hint: "填写你本地部署的 xkapi 地址，模型名与上游一致" },
];

// 通义万相走 DashScope 专用的异步合成任务接口，没有可查询的 /models 列表接口，
// 这里只放常见型号做候选，用户仍可通过 allow-create 直接输入清单外的型号
const imageModelOptions = ["wanx2.1-t2i-turbo", "wan2.7-image-pro"];
const videoModelOptions = ["wan2.6-i2v-flash"];

// ── 一级切换 ──────────────────────────────────────────────────────────────
const mode       = ref("assistant");
const activeType = ref("chat");
const saving     = ref(false);

// ── 全局表单 ──────────────────────────────────────────────────────────────
const form = reactive({
  providers: {
    alibaba:     { label: "阿里云百炼 (Qwen)",      apiKey: "", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    deepseek:    { label: "DeepSeek",               apiKey: "", baseUrl: "https://api.deepseek.com/v1" },
    openai:      { label: "OpenAI",                 apiKey: "", baseUrl: "https://api.openai.com/v1" },
    moonshot:    { label: "月之暗面 (Moonshot)",    apiKey: "", baseUrl: "https://api.moonshot.cn/v1" },
    zhipu:       { label: "智谱 (GLM)",              apiKey: "", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    siliconflow: { label: "硅基流动 (SiliconFlow)", apiKey: "", baseUrl: "https://api.siliconflow.cn/v1" },
    xkapi:     { label: "自建",           apiKey: "", baseUrl: "http://localhost:8080/v1" },
  },
  chat:      { provider: "deepseek", modelName: "deepseek-v3.2", temperature: 0.7, streaming: true, contextWindow: 32000, nativeSearch: false, reasoningEffort: "high" },
  embedding: { provider: "alibaba",  modelName: "text-embedding-v4", dimensions: 1024, batchSize: 10 },
  agentPermissions: { enableShellExecute: false },
  agent: { provider: "deepseek", modelName: "deepseek-v3.2", temperature: 0.7, contextWindow: 32000 },
  media: { provider: "alibaba", imageModel: "wanx2.1-t2i-turbo", videoModel: "wan2.6-i2v-flash" },
});

// ── AI 助手 computed ───────────────────────────────────────────────────────
const currentModel  = computed(() => form[activeType.value]);
const currentPreset = computed(() => presets.find(p => p.id === currentModel.value?.provider));

// 原生联网搜索目前只对模型名匹配这两类的生效，跟主进程 tools.js 里 getNativeSearchTools 的正则保持一致
const nativeSearchDetected = computed(() => {
  const name = String(currentModel.value?.modelName || "");
  if (/^grok/i.test(name)) return "Grok";
  if (/^(gpt-|chatgpt|o[1-9](-|$))/i.test(name)) return "OpenAI";
  return "";
});

const currentApiKey = computed({
  get: () => { const id = currentModel.value?.provider; return (id && form.providers[id]?.apiKey) || ""; },
  set: (val) => { const id = currentModel.value?.provider; if (id && form.providers[id]) form.providers[id].apiKey = val; },
});
const currentBaseUrl = computed({
  get: () => { const id = currentModel.value?.provider; return (id && form.providers[id]?.baseUrl) || ""; },
  set: (val) => { const id = currentModel.value?.provider; if (id && form.providers[id]) form.providers[id].baseUrl = val; },
});

// ── 模型名称下拉：从厂商拉取可用模型列表（可选，失败/未拉取时仍可直接手动输入） ──────────
const modelOptionsMap    = reactive({ chat: [], embedding: [] });
const currentModelOptions = computed(() => modelOptionsMap[activeType.value] || []);
const loadingModelOptions = ref(false);
const agentModelOptions      = ref([]);
const loadingAgentModelOptions = ref(false);

// type: "chat" | "embedding"；silent=true 用于挂载/切换厂商/失焦时的自动拉取，不弹提示、不显示按钮 loading
async function fetchModelListFor(type, { silent = false } = {}) {
  const providerId = form[type]?.provider;
  if (!providerId) { if (!silent) ElMessage.warning("请先选择厂商"); return; }
  const providerCfg = form.providers[providerId];
  const baseUrl = providerCfg?.baseUrl;
  if (!baseUrl) { if (!silent) ElMessage.warning("请先填写 Base URL"); return; }
  if (!silent) loadingModelOptions.value = true;
  try {
    const res = await window.electronAPI.listModels({ baseUrl, apiKey: providerCfg?.apiKey || "" });
    if (res.success) {
      modelOptionsMap[type] = res.models;
      if (!silent && !res.models.length) ElMessage.info("未获取到模型列表，可直接手动输入模型名称");
    } else if (!silent) {
      ElMessage.error(res.error || "获取模型列表失败，可直接手动输入模型名称");
    }
  } catch (e) {
    if (!silent) ElMessage.error("获取模型列表失败：" + (e?.message || "未知错误"));
  } finally {
    if (!silent) loadingModelOptions.value = false;
  }
}

function refreshModelOptions() {
  fetchModelListFor(activeType.value, { silent: false });
}

async function fetchAgentModelList({ silent = false } = {}) {
  if (!form.agent.provider) { if (!silent) ElMessage.warning("请先选择厂商"); return; }
  if (!agentBaseUrl.value) { if (!silent) ElMessage.warning("请先填写 Base URL"); return; }
  if (!silent) loadingAgentModelOptions.value = true;
  try {
    const res = await window.electronAPI.listModels({ baseUrl: agentBaseUrl.value, apiKey: agentApiKey.value });
    if (res.success) {
      agentModelOptions.value = res.models;
      if (!silent && !res.models.length) ElMessage.info("未获取到模型列表，可直接手动输入模型名称");
    } else if (!silent) {
      ElMessage.error(res.error || "获取模型列表失败，可直接手动输入模型名称");
    }
  } catch (e) {
    if (!silent) ElMessage.error("获取模型列表失败：" + (e?.message || "未知错误"));
  } finally {
    if (!silent) loadingAgentModelOptions.value = false;
  }
}

function refreshAgentModelOptions() {
  fetchAgentModelList({ silent: false });
}

// ── 主模型 computed ────────────────────────────────────────────────────────
const agentApiKey = computed({
  get: () => { const id = form.agent.provider; return (id && form.providers[id]?.apiKey) || ""; },
  set: (val) => { const id = form.agent.provider; if (id && form.providers[id]) form.providers[id].apiKey = val; },
});
const agentBaseUrl = computed({
  get: () => { const id = form.agent.provider; return (id && form.providers[id]?.baseUrl) || ""; },
  set: (val) => { const id = form.agent.provider; if (id && form.providers[id]) form.providers[id].baseUrl = val; },
});
function onAgentProviderChange(id) {
  const preset = presets.find(p => p.id === id);
  if (preset && !form.providers[id]) form.providers[id] = { label: preset.label, apiKey: "", baseUrl: preset.baseUrl };
  else if (preset && form.providers[id] && !form.providers[id].baseUrl) form.providers[id].baseUrl = preset.baseUrl;
  agentModelOptions.value = [];
  fetchAgentModelList({ silent: true });
}

// ── Skills ────────────────────────────────────────────────────────────────
const skills            = ref([]);
const loadingSkills     = ref(false);
const skillEditorVisible = ref(false);
const isCreatingSkill   = ref(false);
const savingSkill       = ref(false);

// editingSkillForm.rawContent = SKILL.md 原文
const editingSkillForm = reactive({ name: "", rawContent: "" });

// ── Skills 外部导入 ──────────────────────────────────────────────────────
const importMode        = ref("custom"); // custom | zip | folder | url
const zipInputRef       = ref(null);
const importFileName    = ref("");
const importSourceDirPath = ref(""); // 文件夹导入：用户选中的本地源目录路径
const importUrl         = ref("");
const previewLoading    = ref(false);
const importing         = ref(false);
const importPreview     = ref(null);
const importDirName     = ref("");
const SCRIPT_PATH_RE = /\.(js|mjs|cjs|py|sh|ps1)$/i;

function isScriptPath(p) {
  return p !== "SKILL.md" && SCRIPT_PATH_RE.test(p);
}

function resetImportState() {
  importFileName.value = "";
  importSourceDirPath.value = "";
  importUrl.value = "";
  importPreview.value = null;
  importDirName.value = "";
  if (zipInputRef.value) zipInputRef.value.value = "";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleZipFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  importFileName.value = file.name;
  importPreview.value = null;
  previewLoading.value = true;
  try {
    const zipBase64 = await fileToBase64(file);
    const res = await previewSkillImport({ mode: "zip", zipBase64, fileName: file.name });
    importPreview.value = res.data;
    importDirName.value = res.data.suggestedDirName;
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || "解析压缩包失败");
  } finally {
    previewLoading.value = false;
  }
}

async function handlePickImportFolder() {
  const dirPath = await window.electronAPI.selectSkillImportFolder();
  if (!dirPath) return; // 用户取消
  importSourceDirPath.value = dirPath;
  importPreview.value = null;
  previewLoading.value = true;
  try {
    const res = await previewSkillImport({ mode: "folder", dirPath });
    importPreview.value = res.data;
    importDirName.value = res.data.suggestedDirName;
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || "读取文件夹失败");
  } finally {
    previewLoading.value = false;
  }
}

async function handleFetchPreview() {
  if (!importUrl.value.trim()) { ElMessage.warning("请输入链接"); return; }
  previewLoading.value = true;
  importPreview.value = null;
  try {
    const res = await previewSkillImport({ mode: "url", url: importUrl.value.trim() });
    importPreview.value = res.data;
    importDirName.value = res.data.suggestedDirName;
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || "获取预览失败");
  } finally {
    previewLoading.value = false;
  }
}

async function handleConfirmImport() {
  if (!importPreview.value) return;
  const dirName = importDirName.value.trim();
  if (!dirName) { ElMessage.warning("请输入目录名"); return; }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(dirName)) {
    ElMessage.warning("目录名只能包含小写字母、数字和连字符，且不能以连字符开头/结尾");
    return;
  }
  importing.value = true;
  try {
    await confirmSkillImport({
      dirName,
      filesBase64: importPreview.value.filesBase64,
      meta: {
        source: importPreview.value.source,
        hasScripts: importPreview.value.hasScripts,
        riskFlags: importPreview.value.riskFlags,
        riskLevel: importPreview.value.riskLevel,
      },
    });
    skillEditorVisible.value = false;
    await loadSkills();
    ElMessage.success("已导入，默认禁用，请查看内容后手动启用");
  } catch (err) {
    ElMessage.error(err?.response?.data?.message || "导入失败");
  } finally {
    importing.value = false;
  }
}

// 新建时的 SKILL.md 模板
const SKILL_TEMPLATE = `---
name: 显示名称
description: 描述这个 Skill 的适用场景，Agent 靠这段话决定是否调用，请写清楚
---

## 何时使用

描述触发条件和典型任务场景。

## 操作流程

1. 第一步...
2. 第二步...

## 注意事项

- 注意点...
`;

async function loadSkills() {
  loadingSkills.value = true;
  try { skills.value = (await getAgentSkills()).data || []; }
  catch {} finally { loadingSkills.value = false; }
}

// 启用有风险提示的 skill（导入来源 / 含脚本 / 命中风险扫描）前，先弹窗二次确认
function buildRiskConfirmMessage(sk) {
  const lines = [];
  if (sk.importSource?.url) lines.push(`来源：${sk.importSource.url}`);
  else if (sk.importSource?.dirPath) lines.push(`来源：本地文件夹 ${sk.importSource.dirPath}`);
  else if (sk.importSource?.fileName) lines.push(`来源：本地 zip ${sk.importSource.fileName}`);
  if (sk.hasScripts) lines.push("包含可执行脚本文件，启用后 AI 员工可能会读取并在本机执行相关操作。");
  if (sk.riskFlags?.length) {
    lines.push("内容扫描命中以下风险提示：");
    lines.push(...sk.riskFlags.map((f) => `· ${f}`));
  }
  lines.push("请确认来源可信后再启用。");
  return lines.join("<br/>");
}

async function toggleSkillEnabled(sk, enabled) {
  if (enabled && (sk.hasScripts || sk.riskFlags?.length)) {
    try {
      await ElMessageBox.confirm(buildRiskConfirmMessage(sk), "启用前请确认", {
        confirmButtonText: "我已确认，启用",
        cancelButtonText: "取消",
        type: "warning",
        dangerouslyUseHTMLString: true,
        customClass: "risk-message-box",
      });
    } catch {
      sk.enabled = false; // 用户取消：撤销 el-switch 的乐观更新
      return;
    }
  }
  try { await updateSkillEnabled(sk.name, enabled); }
  catch { ElMessage.error("操作失败"); await loadSkills(); }
}

function openCreateSkill() {
  isCreatingSkill.value = true;
  importMode.value = "custom";
  resetImportState();
  Object.assign(editingSkillForm, { name: "", rawContent: SKILL_TEMPLATE });
  skillEditorVisible.value = true;
}

async function openSkillEditor(sk) {
  isCreatingSkill.value = false;
  Object.assign(editingSkillForm, { name: sk.name, rawContent: "" });
  skillEditorVisible.value = true;
  try {
    const res = await getSkillContent(sk.name);
    editingSkillForm.rawContent = res.data || "";
  } catch { ElMessage.warning("加载 SKILL.md 失败"); }
}

async function handleSaveSkill() {
  if (isCreatingSkill.value) {
    if (!editingSkillForm.name.trim()) { ElMessage.warning("请输入目录名"); return; }
    if (!/^[a-z0-9-_]+$/.test(editingSkillForm.name)) {
      ElMessage.warning("目录名只能包含小写字母、数字、- 和 _"); return;
    }
  }
  if (!editingSkillForm.rawContent.trim()) { ElMessage.warning("内容不能为空"); return; }

  savingSkill.value = true;
  try {
    if (isCreatingSkill.value) {
      // 先建目录（后端会生成默认模板），再立即用编辑器内容覆盖
      await createSkill({ name: editingSkillForm.name });
    }
    await saveSkillContent(editingSkillForm.name, editingSkillForm.rawContent);
    skillEditorVisible.value = false;
    await loadSkills();
    ElMessage.success(isCreatingSkill.value ? "Skill 已创建" : "已保存");
  } catch (e) { ElMessage.error(e?.response?.data?.message || "保存失败"); }
  finally { savingSkill.value = false; }
}

async function handleDeleteSkill(sk) {
  try {
    await ElMessageBox.confirm(`确定删除 Skill「${sk.displayName || sk.name}」？此操作将删除整个目录，不可恢复。`, "确认删除", {
      confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
      customClass: "neon-message-box",
    });
    await deleteSkill(sk.name);
    await loadSkills();
    ElMessage.success("已删除");
  } catch {}
}

// ── 加载配置 ──────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await window.electronAPI.getModelConfig();
    const savedProviders = res.providers || {};
    for (const [id, saved] of Object.entries(savedProviders)) {
      if (!form.providers[id]) form.providers[id] = { label: saved.label || id, apiKey: saved.apiKey || "", baseUrl: saved.baseUrl || "" };
      else {
        if (saved.apiKey)  form.providers[id].apiKey  = saved.apiKey;
        if (saved.baseUrl) form.providers[id].baseUrl = saved.baseUrl;
      }
    }
    if (res.chat)      Object.assign(form.chat,      { provider: res.chat.provider || "deepseek",  modelName: res.chat.modelName || "",      temperature: res.chat.temperature ?? 0.7,      streaming: res.chat.streaming ?? true, contextWindow: res.chat.contextWindow ?? 32000, nativeSearch: res.chat.nativeSearch ?? false, reasoningEffort: res.chat.reasoningEffort ?? "high" });
    if (res.embedding) Object.assign(form.embedding, { provider: res.embedding.provider || "alibaba", modelName: res.embedding.modelName || "", dimensions: res.embedding.dimensions ?? 1024, batchSize: res.embedding.batchSize ?? 10 });
    if (res.agentPermissions) Object.assign(form.agentPermissions, {
      enableShellExecute:  res.agentPermissions.enableShellExecute ?? false,
    });
    if (res.agent)     Object.assign(form.agent,     { provider: res.agent.provider || "deepseek",  modelName: res.agent.modelName || "",     temperature: res.agent.temperature ?? 0.7, contextWindow: res.agent.contextWindow ?? 32000 });
    if (res.media)     Object.assign(form.media,     { provider: "alibaba", imageModel: res.media.imageModel || "wanx2.1-t2i-turbo", videoModel: res.media.videoModel || "wan2.6-i2v-flash" });

    // 已有厂商 + Base URL 的模型，打开页面时静默预拉一次模型列表，不用等用户点刷新
    fetchModelListFor("chat", { silent: true });
    fetchModelListFor("embedding", { silent: true });
    fetchAgentModelList({ silent: true });
  } catch (e) { ElMessage.error("加载配置失败：" + e.message); }
}

function onProviderChange(id) {
  const preset = presets.find(p => p.id === id);
  if (preset && !form.providers[id]) form.providers[id] = { label: preset.label, apiKey: "", baseUrl: preset.baseUrl };
  else if (preset && form.providers[id] && !form.providers[id].baseUrl) form.providers[id].baseUrl = preset.baseUrl;
  modelOptionsMap[activeType.value] = [];
  fetchModelListFor(activeType.value, { silent: true });
}

async function switchToAgent() {
  mode.value = "agent";
  loadSkills();
}

async function handleSave() {
  if (mode.value === "assistant") {
    const model = currentModel.value;
    if (!model.provider)  { ElMessage.warning("请选择厂商"); return; }
    if (!model.modelName) { ElMessage.warning("请输入模型名称"); return; }
  } else {
    if (!form.agent.provider)  { ElMessage.warning("请选择主模型厂商"); return; }
    if (!form.agent.modelName) { ElMessage.warning("请输入主模型名称"); return; }
  }
  saving.value = true;
  try {
    const payload = JSON.parse(JSON.stringify({
      providers:        form.providers,
      chat:             { provider: form.chat.provider,      modelName: form.chat.modelName,      temperature: form.chat.temperature,      streaming: form.chat.streaming, contextWindow: form.chat.contextWindow, nativeSearch: form.chat.nativeSearch, reasoningEffort: form.chat.reasoningEffort },
      embedding:        { provider: form.embedding.provider, modelName: form.embedding.modelName, dimensions: form.embedding.dimensions,  batchSize: form.embedding.batchSize },
      agentPermissions: {
        enableShellExecute:  form.agentPermissions.enableShellExecute,
      },
      agent:            { provider: form.agent.provider,     modelName: form.agent.modelName,     temperature: form.agent.temperature, contextWindow: form.agent.contextWindow },
      media:            { provider: form.media.provider,     imageModel: form.media.imageModel,   videoModel: form.media.videoModel },
    }));
    await window.electronAPI.updateModelConfig(payload);
    ElMessage.success("配置已保存");
  } catch (e) { ElMessage.error("保存失败：" + (e?.message || "未知错误")); }
  finally { saving.value = false; }
}

async function handleReset() {
  try {
    await ElMessageBox.confirm("恢复默认配置会清除当前设置，确认？", "提示", { type: "warning" });
    await window.electronAPI.updateModelConfig(null);
    await loadConfig();
    ElMessage.info("已恢复默认配置");
  } catch {}
}

onMounted(async () => {
  const q = router.currentRoute.value.query.optionId;
  if (q === "agent") { mode.value = "agent"; }
  else if (q && ["chat", "vision", "embedding"].includes(q)) { activeType.value = q; }
  await loadConfig();
  if (mode.value === "agent") { loadSkills(); }
});
</script>

<style scoped lang="scss">
.page-wrap {
  padding: 24px 20px;
  display: flex;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
}

.glass-card {
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.3);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08);
}

.config-card { width: 80%; padding: 0 0 32px; align-self: flex-start; }

.card-top-bar {
  height: 3px;
  background: linear-gradient(90deg, #667eea, #a78bfa, #38bdf8);
  border-radius: 16px 16px 0 0;
  opacity: 0.85;
}

.card-decoration {
  position: absolute; top: -30px; right: -30px;
  width: 140px; height: 140px;
  background: radial-gradient(circle, rgba(102,126,234,0.15) 0%, transparent 70%);
  pointer-events: none; border-radius: 50%;
}

.card-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 28px 16px; }
.card-title { font-size: 18px; font-weight: 700; color: #e8eaf6; letter-spacing: 0.5px; }

.mode-tabs { display: flex; background: rgba(255,255,255,0.05); border: 1px solid rgba(99,148,255,0.2); border-radius: 10px; padding: 3px; gap: 2px; }
.mode-tab {
  padding: 6px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;
  color: #7986a8; cursor: pointer; transition: all 0.2s; user-select: none;
  &:hover { color: #c8d0e8; }
  &.active { background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%); color: #fff; box-shadow: 0 2px 8px rgba(102,126,234,0.4); }
}

.card-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(102,126,234,0.3), transparent); margin: 0 28px 0; }

.dark-form {
  padding: 0 28px;
  :deep(.el-form-item__label) { color: #8a9bc0; font-size: 13px; }
  :deep(.el-input__wrapper) { background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(99,148,255,0.25) !important; box-shadow: none !important; border-radius: 8px !important; &:hover { border-color: rgba(102,126,234,0.5) !important; } &.is-focus { border-color: #667eea !important; box-shadow: 0 0 0 2px rgba(102,126,234,0.15) !important; } }
  :deep(.el-input__inner) { color: #e8eaf6 !important; }
  :deep(.el-input__inner::placeholder) { color: #4a5a7a !important; }
  :deep(.el-select .el-select__wrapper) { background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(99,148,255,0.25) !important; box-shadow: none !important; border-radius: 8px !important; color: #e8eaf6 !important; &:hover, &.is-focused { border-color: #667eea !important; } }
  :deep(.el-select__placeholder) { color: #4a5a7a !important; }
  :deep(.el-textarea__inner) { background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(99,148,255,0.25) !important; color: #e8eaf6 !important; box-shadow: none !important; border-radius: 8px !important; &::placeholder { color: #4a5a7a !important; } }
  :deep(.el-switch__label) { color: #7986a8 !important; }
  :deep(.el-checkbox__label) { color: #8a9bc0; font-size: 12px; }
  :deep(.el-checkbox__inner) { background: rgba(15,23,42,0.6); border-color: rgba(99,148,255,0.3); }
  :deep(.el-input-number .el-input__wrapper) { background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(99,148,255,0.25) !important; box-shadow: none !important; }
  :deep(.el-input-number__decrease), :deep(.el-input-number__increase) {
    background: rgba(255,255,255,0.06) !important; border-color: rgba(99,148,255,0.25) !important; color: #8a9bc0 !important;
    &:hover { color: #a5b4fc !important; }
  }
  :deep(.el-button):not(.is-text):not(.is-link):not(.add-btn) {
    background: rgba(255,255,255,0.06) !important; border: 1px solid rgba(99,148,255,0.25) !important; color: #94a3b8 !important;
    &:hover { background: rgba(102,126,234,0.15) !important; border-color: rgba(102,126,234,0.5) !important; color: #c7d2fe !important; }
    &.is-disabled, &.is-disabled:hover { opacity: 0.4; background: rgba(255,255,255,0.03) !important; border-color: rgba(99,148,255,0.12) !important; color: #4a5a7a !important; }
    &.el-button--primary {
      background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%) !important; border: none !important; color: #fff !important;
      &:hover { filter: brightness(1.1); }
      &.is-disabled, &.is-disabled:hover { opacity: 0.5; filter: none; }
    }
  }
}

.model-select-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.slider-row { display: flex; align-items: center; gap: 12px; width: 100%; }
.slider-val  { font-size: 13px; color: #a5b4fc; min-width: 28px; text-align: right; }
.tip         { font-size: 12px; color: #4a5a7a; margin-top: 4px; line-height: 1.4; }
.warn-tip    { color: #f59e0b; }
.desc-tip    { color: #c8974a; }

.assistant-wrap { padding-top: 8px; }

.dark-tabs {
  padding: 0 28px;
  :deep(.el-tabs__nav-wrap::after) { background: rgba(99,148,255,0.15) !important; height: 1px !important; }
  :deep(.el-tabs__item) { color: #5a6a88; font-size: 14px; font-weight: 500; padding: 0 20px; &:hover { color: #a5b4fc; } &.is-active { color: #c7d2fe; font-weight: 600; } }
  :deep(.el-tabs__active-bar) { background: linear-gradient(90deg, #667eea, #a78bfa); height: 2px; border-radius: 1px; }
}

.agent-wrap { display: flex; flex-direction: column; }

.agent-block { padding: 20px 28px; border-bottom: 1px solid rgba(102,126,234,0.1); &:last-of-type { border-bottom: none; } }

.block-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #c8d0e8; margin-bottom: 16px; }
.block-dot   { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #a78bfa); flex-shrink: 0; }
.block-tip   { font-size: 12px; color: #4a5a7a; font-weight: 400; margin-left: 4px; }

/* Skills 库 */
.skill-list { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; margin-bottom: 12px; &::-webkit-scrollbar { width: 4px; } &::-webkit-scrollbar-thumb { background: rgba(102,126,234,0.3); border-radius: 2px; } }
.skill-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(99,148,255,0.15); border-radius: 10px; padding: 12px 14px; transition: border-color 0.2s; &:hover { border-color: rgba(102,126,234,0.35); } }
.skill-header { display: flex; align-items: center; justify-content: space-between; }
.skill-left   { display: flex; align-items: center; gap: 10px; }
.skill-info   { display: flex; flex-direction: column; }
.skill-name   { font-size: 14px; font-weight: 600; color: #e8eaf6; }
.skill-dir    { font-size: 11px; color: #4a5a7a; margin-top: 1px; }
.skill-actions  { display: flex; align-items: center; gap: 2px; }
.skill-name-row { display: flex; align-items: center; gap: 6px; }
.builtin-tag    { border-color: rgba(167,139,250,0.4) !important; color: #a78bfa !important; background: rgba(167,139,250,0.08) !important; font-size: 10px !important; padding: 0 5px !important; height: 16px !important; line-height: 16px !important; }
.skill-desc     { font-size: 12px; color: #5a6a88; margin-top: 6px; padding-left: 46px; line-height: 1.5; }

/* 共用添加按钮 */
.add-btn {
  background: rgba(102,126,234,0.1); border: 1px dashed rgba(102,126,234,0.35);
  color: #a5b4fc; border-radius: 8px; width: 100%; transition: all 0.2s;
  &:hover { background: rgba(102,126,234,0.2); border-color: rgba(102,126,234,0.6); color: #c7d2fe; }
}

/* ── Dialogs：复用 rag/writeStyle 页统一的 neon-dialog 弹窗风格 ── */
:deep(.skill-editor-dialog .el-dialog__body) { padding: 16px 20px; }

.cancel-btn {
  background: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: #94a3b8 !important;
  &:hover { border-color: rgba(255, 255, 255, 0.4) !important; color: #f1f5f9 !important; }
}

.confirm-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
}

.skill-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dir-form {
  padding: 0 !important;
  :deep(.el-form-item) { margin-bottom: 0; }
}

.editor-label {
  font-size: 13px;
  font-weight: 600;
  color: #c8d0e8;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.editor-hint { font-size: 11px; color: #4a5a7a; font-weight: 400; }

.raw-editor {
  :deep(.el-textarea__inner) {
    background: rgba(255,255,255,0.06) !important;
    border: 1px solid rgba(99,148,255,0.25) !important;
    color: #e8eaf6 !important;
    box-shadow: none !important;
    border-radius: 8px !important;
    font-family: "Courier New", Consolas, monospace !important;
    font-size: 13px !important;
    line-height: 1.7 !important;
    &::placeholder { color: #4a5a7a !important; }
    &:focus { border-color: #667eea !important; box-shadow: 0 0 0 2px rgba(102,126,234,0.15) !important; }
  }
}

/* Skill 导入 */
.import-mode-group {
  margin-bottom: 4px;
  :deep(.el-radio-button__inner) {
    background: rgba(255,255,255,0.06); border-color: rgba(99,148,255,0.25); color: #8a9bc0; box-shadow: none !important;
  }
  :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
    background: linear-gradient(135deg, #667eea 0%, #5a67d8 100%); border-color: #667eea; color: #fff;
  }
}

.hidden-file-input { display: none; }

.import-source-row { display: flex; align-items: center; gap: 10px; }

.import-file-name { font-size: 12px; color: #8a9bc0; }

.import-preview-card {
  margin-top: 6px; padding: 14px 16px; border-radius: 10px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(99,148,255,0.15);
  display: flex; flex-direction: column; gap: 10px;
}

.preview-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.preview-name   { font-size: 14px; font-weight: 600; color: #e8eaf6; }
.preview-desc   { font-size: 12px; color: #8a9bc0; line-height: 1.5; }

.preview-risk-box {
  padding: 10px 12px; border-radius: 8px;
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
  font-size: 12px; color: #fca5a5;
  ul { margin: 6px 0 0; padding-left: 18px; }
  li { line-height: 1.6; }
}
.preview-risk-title { font-weight: 600; color: #f87171; }

.preview-files { font-size: 12px; }
.preview-files-title { color: #8a9bc0; margin-bottom: 4px; }
.preview-file-row {
  display: flex; justify-content: space-between; padding: 3px 0;
  color: #5a6a88; border-bottom: 1px dashed rgba(99,148,255,0.1);
  &:last-child { border-bottom: none; }
}
.file-path.is-script { color: #f59e0b; }
.file-size { color: #4a5a7a; }

</style>

<!--
  ElMessageBox.confirm() 是命令式调用，挂载出来的 DOM 会直接 append 到 <body> 下，
  完全脱离本组件的渲染树——跟模板里声明的 <el-dialog>（内部走 Vue <Teleport>，会保留 scope id）不一样，
  所以下面这些类必须写在不带 scoped 的样式块里，:deep() 在这里永远匹配不到。
-->
<style>
.neon-message-box {
  background: rgba(15, 23, 42, 0.95) !important;
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
  border-radius: 16px !important;
}
.neon-message-box .el-message-box__title   { color: #f1f5f9; }
.neon-message-box .el-message-box__message { color: #94a3b8; line-height: 1.6; }
.neon-message-box .el-message-box__btns .el-button {
  background: transparent !important; border: 1px solid rgba(255,255,255,0.2) !important; color: #94a3b8 !important;
}
.neon-message-box .el-message-box__btns .el-button:hover {
  border-color: rgba(255,255,255,0.4) !important; color: #f1f5f9 !important;
}
.neon-message-box .el-message-box__btns .el-button--primary {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
  border: none !important; color: #fff !important;
  box-shadow: 0 4px 15px rgba(239,68,68,0.4) !important;
}

/* 启用有风险的 Skill 前的二次确认框：琥珀色调，对应"谨慎"而非"删除"的语义 */
.risk-message-box {
  background: rgba(15, 23, 42, 0.95) !important;
  border: 1px solid rgba(245, 158, 11, 0.35) !important;
  border-radius: 16px !important;
}
.risk-message-box .el-message-box__title   { color: #f1f5f9; }
.risk-message-box .el-message-box__message { color: #94a3b8; line-height: 1.7; }
.risk-message-box .el-message-box__status  { color: #f59e0b !important; }
.risk-message-box .el-message-box__btns .el-button {
  background: transparent !important; border: 1px solid rgba(255,255,255,0.2) !important; color: #94a3b8 !important;
}
.risk-message-box .el-message-box__btns .el-button:hover {
  border-color: rgba(255,255,255,0.4) !important; color: #f1f5f9 !important;
}
.risk-message-box .el-message-box__btns .el-button--primary {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
  border: none !important; color: #fff !important;
  box-shadow: 0 4px 15px rgba(245,158,11,0.4) !important;
}

/* el-select 下拉选项面板同样是 append-to-body，走同样的非-scoped 处理方式 */
.dark-select-popper.el-popper {
  background: rgba(15, 23, 42, 0.97) !important;
  border: 1px solid rgba(99, 148, 255, 0.3) !important;
}
.dark-select-popper .el-popper__arrow::before {
  background: rgba(15, 23, 42, 0.97) !important;
  border-color: rgba(99, 148, 255, 0.3) !important;
}
.dark-select-popper .el-select-dropdown__item {
  color: #c8d0e8;
}
.dark-select-popper .el-select-dropdown__item.is-hovering,
.dark-select-popper .el-select-dropdown__item:hover {
  background: rgba(102, 126, 234, 0.15) !important;
}
.dark-select-popper .el-select-dropdown__item.is-selected {
  color: #a5b4fc !important;
  font-weight: 600;
  background: rgba(102, 126, 234, 0.12) !important;
}
.dark-select-popper .el-select-dropdown__item.is-disabled {
  color: #4a5a7a;
}
.dark-select-popper .el-select-dropdown__empty {
  color: #7986a8 !important;
}
</style>
