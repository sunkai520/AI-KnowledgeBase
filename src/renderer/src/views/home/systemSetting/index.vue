<template>
  <div class="page-wrap">
  <div class="setting-layout">

    <!-- 左侧菜单 -->
    <aside class="sidebar">
      <div class="sidebar-title">系统配置</div>
      <nav class="menu">
        <div
          v-for="item in menuItems"
          :key="item.key"
          :class="['menu-item', { active: activeMenu === item.key }]"
          @click="activeMenu = item.key"
        >
          <span class="menu-icon">{{ item.icon }}</span>
          <span class="menu-label">{{ item.label }}</span>
        </div>
      </nav>
    </aside>

    <!-- 右侧内容 -->
    <main class="content">
      <div class="content-header">
        <h2 class="content-title">{{ currentMenu.label }}</h2>
        <p class="content-desc">{{ currentMenu.desc }}</p>
      </div>
      <div class="content-divider"></div>

      <!-- 个人中心 -->
      <el-form v-if="activeMenu === 'profile'" label-width="120px" size="default" class="dark-form">
        <el-form-item label="头像">
          <div class="avatar-edit-row">
            <div class="avatar-wrap" @click="triggerAvatarSelect">
              <img :src="userAvatar || defaultAvatarPreview" class="avatar-preview" />
              <div class="avatar-mask">更换</div>
            </div>
            <input
              ref="avatarInputRef"
              type="file"
              accept="image/*"
              style="display: none"
              @change="onAvatarChange"
            />
            <el-button v-if="userAvatar" size="small" @click="resetAvatar">恢复默认</el-button>
          </div>
        </el-form-item>
        <el-form-item label="昵称">
          <div class="row-with-btn">
            <el-input v-model="userNickname" placeholder="🙂AI助手🙂" maxlength="20" show-word-limit clearable />
            <el-button type="primary" @click="saveNickname">保存</el-button>
          </div>
          <div class="tip">显示在首页头像下方</div>
        </el-form-item>

        <div class="content-divider" style="margin: 16px 0;" />

        <el-form-item label="数据目录">
          <div class="row-with-btn">
            <el-input :value="dataDir || '未配置'" readonly />
            <el-button @click="openDataDir">打开目录</el-button>
            <el-button @click="changeDataDir">更改</el-button>
          </div>
          <div class="tip">对话记录、知识库、模型配置均存储于此目录</div>
        </el-form-item>
        <el-form-item label="用户标识">
          <el-input :value="machineId || '获取中...'" readonly />
        </el-form-item>

        <div class="content-divider" style="margin: 16px 0;" />

        <el-form-item label="浏览器路径">
          <div class="row-with-btn">
            <el-input v-model="browserExePath" :placeholder="detectedExePath || '未检测到 Chrome/Edge，请手动选择'" clearable />
            <el-button @click="selectBrowserExe">选择</el-button>
            <el-button v-if="detectedExePath && !browserExePath" @click="browserExePath = detectedExePath">自动填充</el-button>
          </div>
          <div class="tip" v-if="detectedExePath">自动检测到：{{ detectedExePath }}</div>
          <div class="tip" v-else>超级员工打开浏览器时使用的可执行文件，留空自动检测</div>
        </el-form-item>
        <el-form-item label="浏览器数据目录">
          <div class="row-with-btn">
            <el-input v-model="browserUserDataDir" :placeholder="detectedUserDataDir || '未检测到数据目录'" clearable />
            <el-button @click="selectBrowserUserDataDir">选择</el-button>
            <el-button v-if="detectedUserDataDir && !browserUserDataDir" @click="browserUserDataDir = detectedUserDataDir">自动填充</el-button>
          </div>
          <div class="tip" v-if="detectedUserDataDir">自动检测到：{{ detectedUserDataDir }}</div>
          <div class="tip" v-else>配置后超级员工可使用你浏览器中保存的登录状态</div>
          <div class="tip" style="color: #e6a23c">若填的是 Chrome 正在使用的目录，使用超级员工浏览器功能前请先关闭 Chrome，否则可能冲突弹出空白标签页</div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button type="primary" :loading="savingBrowser" @click="saveBrowserConfig">保存浏览器配置</el-button>
        </el-form-item>
      </el-form>

      <!-- 代理设置 -->
      <el-form v-if="activeMenu === 'proxy'" label-width="110px" size="default" class="dark-form">
        <el-form-item label="启用代理">
          <el-switch v-model="proxyEnabled" @change="updateActiveProxy" />
          <span class="tip" style="margin-left:12px">启用后联网搜索等功能将通过代理访问</span>
        </el-form-item>
        <el-form-item label="代理模式">
          <el-radio-group v-model="proxyMode" :disabled="!proxyEnabled" @change="updateActiveProxy">
            <el-radio-button label="direct">直连</el-radio-button>
            <el-radio-button label="global">全局代理</el-radio-button>
            <el-radio-button label="pac">PAC 模式</el-radio-button>
          </el-radio-group>
          <div class="tip" style="margin-left: 10px;">全局代理会让联网搜索全部走代理；PAC 模式仅让常见国外站点走代理，其余直连。</div>
        </el-form-item>
        <el-form-item label="代理地址">
          <el-input
            v-model="proxyUrl"
            placeholder="http://127.0.0.1:7890"
            :disabled="!proxyEnabled || proxyMode === 'direct'"
            clearable
          />
          <div class="tip">支持 http / https / socks5 协议，例如 socks5://127.0.0.1:7890。PAC 模式会把它作为上游代理。</div>
        </el-form-item>
        <el-form-item label=" ">
          <el-button type="primary" :loading="saving" @click="saveProxy">保存配置</el-button>
          <el-button :loading="testing" :disabled="!proxyEnabled || proxyMode === 'direct' || !proxyUrl" @click="testProxy">
            测试连接
          </el-button>
        </el-form-item>
        <el-form-item label="当前生效">
          <el-tag :type="activeProxy ? 'success' : 'info'" size="large">
            {{ activeProxy || '直连（未配置代理）' }}
          </el-tag>
        </el-form-item>
        <el-alert
          v-if="proxyEnabled && proxyMode !== 'direct' && !proxyUrl"
          title="已启用代理但未填写地址，联网功能将按直连处理"
          type="warning"
          :closable="false"
          style="margin-top:4px"
        />

        <template v-if="proxyMode === 'pac'">
          <div class="content-divider" style="margin: 16px 0;" />
          <el-form-item label="PAC 名单">
            <div class="row-with-btn">
              <el-tag v-if="pacListInfo.fetching" type="warning" size="large">下载中...</el-tag>
              <el-tag v-else-if="pacListInfo.source === 'remote'" type="success" size="large">
                已就绪 · {{ pacListInfo.count.toLocaleString() }} 条 · {{ formatPacTime(pacListInfo.updatedAt) }}
              </el-tag>
              <el-tag v-else type="info" size="large">尚未下载，将在切到 PAC 模式并保存后自动获取</el-tag>
              <el-button :loading="updatingList" @click="updatePacList">{{ pacListInfo.source === 'remote' ? '更新' : '立即下载' }}</el-button>
            </div>
            <div class="tip">PAC 模式默认全部走代理，命中中国大陆域名白名单则直连；名单下载后缓存到你配置的数据目录，不打包进安装包，链接失效也不影响已下载的版本。</div>
          </el-form-item>

          <el-form-item label="国外网站">
            <div class="domain-tag-list">
              <el-tag
                v-for="d in forceProxyDomains"
                :key="d"
                closable
                @close="removeDomain('proxy', d)"
              >{{ d }}</el-tag>
              <el-input
                v-model="forceProxyInput"
                placeholder="example.com，回车添加"
                class="domain-input"
                @keyup.enter="addDomain('proxy')"
                @blur="addDomain('proxy')"
              />
            </div>
            <div class="tip">白名单误判为直连时，加到这里强制走代理。</div>
          </el-form-item>

          <el-form-item label="国内网站">
            <div class="domain-tag-list">
              <el-tag
                v-for="d in forceDirectDomains"
                :key="d"
                closable
                @close="removeDomain('direct', d)"
              >{{ d }}</el-tag>
              <el-input
                v-model="forceDirectInput"
                placeholder="example.com，回车添加"
                class="domain-input"
                @keyup.enter="addDomain('direct')"
                @blur="addDomain('direct')"
              />
            </div>
            <div class="tip">名单没覆盖到的国内站点，加到这里强制直连。</div>
          </el-form-item>
        </template>
      </el-form>

      <!-- 报告模板 -->
      <div v-if="activeMenu === 'template'" class="tpl-section">
        <!-- 模板选择行 -->
        <div class="tpl-sel-row">
          <div
            v-for="tpl in TEMPLATE_DEFS"
            :key="tpl.id"
            :class="['tpl-sel-card', { editing: editingId === tpl.id, inuse: activeTemplateId === tpl.id }]"
            @click="selectEdit(tpl.id)"
          >
            <div class="tpl-inuse-badge" v-if="activeTemplateId === tpl.id">使用中</div>
            <div class="tpl-dots">
              <span class="dot" :style="{ background: '#' + mergedForm(tpl.id).primary }"></span>
              <span class="dot" :style="{ background: '#' + mergedForm(tpl.id).accent }"></span>
              <span class="dot" :style="{ background: '#' + mergedForm(tpl.id).h2Bg }"></span>
            </div>
            <div class="tpl-sel-name">{{ tpl.label }}</div>
          </div>
        </div>

        <!-- 主体：编辑区 + 预览区 -->
        <div class="tpl-body">
          <!-- 左：属性编辑 -->
          <div class="tpl-editor">
            <div class="editor-title">编辑「{{ currentEditTpl.label }}」模板</div>

            <div class="field-group">
              <div class="field-row">
                <label>主色</label>
                <div class="color-row">
                  <input type="color" :value="'#' + editForm.primary"
                    @input="editForm.primary = $event.target.value.slice(1)" />
                  <span class="hex">#{{ editForm.primary }}</span>
                </div>
              </div>
              <div class="field-row">
                <label>强调色</label>
                <div class="color-row">
                  <input type="color" :value="'#' + editForm.accent"
                    @input="editForm.accent = $event.target.value.slice(1)" />
                  <span class="hex">#{{ editForm.accent }}</span>
                </div>
              </div>
              <div class="field-row">
                <label>标题背景</label>
                <div class="color-row">
                  <input type="color" :value="'#' + editForm.h2Bg"
                    @input="editForm.h2Bg = $event.target.value.slice(1)" />
                  <span class="hex">#{{ editForm.h2Bg }}</span>
                </div>
              </div>
              <div class="field-row">
                <label>表头颜色</label>
                <div class="color-row">
                  <input type="color" :value="'#' + editForm.tblHeader"
                    @input="editForm.tblHeader = $event.target.value.slice(1)" />
                  <span class="hex">#{{ editForm.tblHeader }}</span>
                </div>
              </div>
            </div>

            <div class="field-group">
              <div class="field-row">
                <label>正文字体</label>
                <select v-model="editForm.bodyFont" class="sel">
                  <option value="Microsoft YaHei">微软雅黑</option>
                  <option value="宋体">宋体</option>
                  <option value="仿宋">仿宋</option>
                  <option value="黑体">黑体</option>
                  <option value="楷体">楷体</option>
                  <option value="Times New Roman">Times New Roman</option>
                </select>
              </div>
              <div class="field-row">
                <label>正文字号</label>
                <select v-model.number="editForm.bodySize" class="sel">
                  <option :value="20">10pt</option>
                  <option :value="21">10.5pt</option>
                  <option :value="22">11pt</option>
                  <option :value="24">12pt</option>
                  <option :value="26">13pt</option>
                </select>
              </div>
              <div class="field-row">
                <label>行间距</label>
                <select v-model.number="editForm.lineSpacing" class="sel">
                  <option :value="240">单倍</option>
                  <option :value="288">1.2倍</option>
                  <option :value="360">1.5倍</option>
                  <option :value="400">1.67倍</option>
                  <option :value="480">双倍</option>
                </select>
              </div>
              <div class="field-row">
                <label>首行缩进</label>
                <select v-model.number="editForm.firstLine" class="sel">
                  <option :value="0">无</option>
                  <option :value="440">2字符</option>
                </select>
              </div>
            </div>

            <div class="editor-actions">
              <el-button size="small" @click="resetTemplate">恢复默认</el-button>
              <el-button size="small" type="primary" @click="saveTemplate">保存样式</el-button>
              <el-button
                size="small"
                :type="activeTemplateId === editingId ? 'success' : 'primary'"
                @click="setActiveTemplate"
              >
                {{ activeTemplateId === editingId ? '✓ 使用中' : '设为当前' }}
              </el-button>
            </div>
          </div>

          <!-- 右：预览 -->
          <div class="tpl-preview-wrap">
            <!-- <div class="preview-label">预览效果（{{ currentEditTpl.label }}）</div> -->
            <div class="preview-scaler-wrap">
              <iframe
                class="preview-iframe"
                :srcdoc="previewHtml"
                sandbox="allow-same-origin"
                scrolling="no"
              ></iframe>
            </div>
          </div>
        </div>
      </div>

    </main>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import router from '../../../router';
import defaultAvatarPreview from '@renderer/assets/img/default.png';

const menuItems = [
  { key: 'profile',  icon: '👤', label: '个人中心',  desc: '查看应用信息与数据目录' },
  { key: 'proxy',    icon: '🌐', label: '代理设置',  desc: '配置网络代理，用于联网搜索等功能' },
  { key: 'template', icon: '📄', label: '报告模板',  desc: '自定义报告生成的样式、字体与排版' },
];

const activeMenu = ref('profile');
const currentMenu = computed(() => menuItems.find(m => m.key === activeMenu.value) || menuItems[0]);

// ── 个人中心 ──────────────────────────────────────────────────────────────
const userAvatar = ref('');
const userNickname = ref('');
const avatarInputRef = ref(null);
const dataDir = ref('');
const machineId = ref('');
const browserExePath = ref('');
const browserUserDataDir = ref('');
const savingBrowser = ref(false);
const detectedExePath = ref('');
const detectedUserDataDir = ref('');

// ── 代理 ──────────────────────────────────────────────────────────────────
const proxyEnabled = ref(false);
const proxyMode = ref('global');
const proxyUrl = ref('');
const activeProxy = ref('');
const saving = ref(false);
const testing = ref(false);

// ── PAC 名单 ──────────────────────────────────────────────────────────────
const pacListInfo = ref({ version: '', count: 0, updatedAt: null, source: 'none', fetching: false });
const updatingList = ref(false);
const forceProxyDomains = ref([]);
const forceDirectDomains = ref([]);
const forceProxyInput = ref('');
const forceDirectInput = ref('');

// ── 报告模板 ──────────────────────────────────────────────────────────────
const TEMPLATE_DEFS = [
  {
    id: 'business', label: '商务',
    primary: '1A3A5C', accent: '2980B9', h2Bg: 'E8F0F8',
    h3Color: '2C5F8A', h3Border: 'B0C8E8', h4Color: '34495E', h5Color: '555555',
    bodyColor: '2D2D2D', tblBorder: 'C8D8EA', tblHeader: '1A3A5C', tblEven: 'F0F5FA',
    quoteBg: 'F0F6FC', bodyFont: 'Microsoft YaHei', bodySize: 21,
    lineSpacing: 360, firstLine: 0,
    cssFontFamily: '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
    cssFontSize: '10.5pt', cssLineHeight: '1.85',
  },
  {
    id: 'report', label: '报告',
    primary: '7B1818', accent: 'C0392B', h2Bg: 'FFF0EE',
    h3Color: '8B2000', h3Border: 'F0B0A0', h4Color: '5C2A00', h5Color: '6B4040',
    bodyColor: '1A1A1A', tblBorder: 'EEB0A0', tblHeader: '7B1818', tblEven: 'FFF8F6',
    quoteBg: 'FFF3F0', bodyFont: '仿宋', bodySize: 22,
    lineSpacing: 480, firstLine: 440,
    cssFontFamily: '"FangSong","仿宋","SimSun","宋体",serif',
    cssFontSize: '11pt', cssLineHeight: '2.0',
  },
  {
    id: 'simple', label: '简约',
    primary: '2C2C2C', accent: '888888', h2Bg: 'F5F5F5',
    h3Color: '444444', h3Border: 'CCCCCC', h4Color: '555555', h5Color: '777777',
    bodyColor: '2C2C2C', tblBorder: 'CCCCCC', tblHeader: '444444', tblEven: 'F9F9F9',
    quoteBg: 'F7F7F7', bodyFont: '宋体', bodySize: 22,
    lineSpacing: 400, firstLine: 0,
    cssFontFamily: '"宋体","SimSun",serif',
    cssFontSize: '11pt', cssLineHeight: '1.9',
  },
  {
    id: 'academic', label: '学术',
    primary: '1B2A4A', accent: '3D5A80', h2Bg: 'EDF1F7',
    h3Color: '1B2A4A', h3Border: 'A0B0CC', h4Color: '2E3E5C', h5Color: '4A5A7A',
    bodyColor: '1A1A1A', tblBorder: 'A0B4CC', tblHeader: '1B2A4A', tblEven: 'F0F3F8',
    quoteBg: 'F4F6FA', bodyFont: '宋体', bodySize: 22,
    lineSpacing: 480, firstLine: 440,
    cssFontFamily: '"Times New Roman","宋体","SimSun",serif',
    cssFontSize: '11pt', cssLineHeight: '2.0',
  },
  {
    id: 'intel', label: '情报',
    primary: '0D1B2A', accent: 'B45309', h2Bg: 'FEF3C7',
    h3Color: 'D97706', h3Border: 'F59E0B', h4Color: '78350F', h5Color: '92400E',
    bodyColor: '1A1A1A', tblBorder: 'D97706', tblHeader: '1C2D3E', tblEven: 'FFFDF0',
    quoteBg: 'FFFBEB', bodyFont: 'Microsoft YaHei', bodySize: 21,
    lineSpacing: 360, firstLine: 0,
    cssFontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
    cssFontSize: '10.5pt', cssLineHeight: '1.85',
  },
];

// 用户自定义 { templateId: { primary, accent, ... } }
const customizations = ref({});
// 当前生效的模板 id
const activeTemplateId = ref('business');

const editingId = ref('business');
const currentEditTpl = computed(() => TEMPLATE_DEFS.find(t => t.id === editingId.value) || TEMPLATE_DEFS[0]);

// 合并 base + 自定义，用于色点预览
function mergedForm(id) {
  const base = TEMPLATE_DEFS.find(t => t.id === id) || TEMPLATE_DEFS[0];
  return { ...base, ...(customizations.value[id] || {}) };
}

// 当前编辑表单（reactive copy）
const editForm = ref({ ...TEMPLATE_DEFS[0] });

function selectEdit(id) {
  editingId.value = id;
  const merged = mergedForm(id);
  editForm.value = { ...merged };
}

function resetTemplate() {
  const base = TEMPLATE_DEFS.find(t => t.id === editingId.value);
  editForm.value = { ...base };
}

async function setActiveTemplate() {
  activeTemplateId.value = editingId.value;
  try {
    await window.electronAPI.setSetting('activeTemplateId', editingId.value);
    ElMessage.success(`已切换为「${currentEditTpl.value.label}」模板`);
  } catch {
    ElMessage.error('保存失败');
  }
}

async function saveTemplate() {
  const base = TEMPLATE_DEFS.find(t => t.id === editingId.value);
  // 只存与默认值不同的字段
  const delta = {};
  const fields = ['primary','accent','h2Bg','tblHeader','bodyFont','bodySize','lineSpacing','firstLine'];
  fields.forEach(k => {
    if (String(editForm.value[k]) !== String(base[k])) delta[k] = editForm.value[k];
  });
  const all = { ...customizations.value };
  if (Object.keys(delta).length > 0) {
    all[editingId.value] = delta;
  } else {
    delete all[editingId.value];
  }
  customizations.value = all;
  try {
    await window.electronAPI.setSetting('templateCustomizations', all);
    ElMessage.success('模板已保存');
  } catch {
    ElMessage.error('保存失败');
  }
}

// 预览 HTML（iframe srcdoc）
const previewHtml = computed(() => {
  const f = editForm.value;
  const bodyPt = Math.round(f.bodySize / 2);
  const lineH = { 240: '1.2', 288: '1.4', 360: '1.65', 400: '1.8', 480: '2.2' }[f.lineSpacing] || '1.65';
  const indent = f.firstLine ? 'text-indent:2em;' : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:${f.cssFontFamily || '"Microsoft YaHei",sans-serif'};
  font-size:${bodyPt}pt;line-height:${lineH};
  color:#${f.bodyColor};background:#fff;
  padding:24px 28px;
}
h1{
  font-size:${Math.round(f.h1Size||36)/2}pt;font-weight:700;
  color:#${f.primary};text-align:center;
  border-bottom:3px solid #${f.accent};
  padding-bottom:8px;margin-bottom:14px;letter-spacing:1px;
}
h2{
  font-size:${Math.round(f.h2Size||28)/2}pt;font-weight:700;
  color:#${f.primary};
  background:linear-gradient(90deg,#${f.h2Bg} 0%,#fafafa 100%);
  border-left:4px solid #${f.accent};
  padding:5px 10px;margin:18px 0 8px;border-radius:0 3px 3px 0;
}
h3{
  font-size:${Math.round(f.h3Size||24)/2}pt;font-weight:700;
  color:#${f.h3Color||f.primary};
  border-bottom:1px dashed #${f.h3Border||f.accent};
  padding-bottom:3px;margin:12px 0 6px;
}
p{margin:0 0 7px;${indent}}
ul{margin:4px 0 8px;padding-left:20px}
li{margin-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:${bodyPt - 1}pt;margin:10px 0}
thead tr{background:#${f.tblHeader}}
th{color:#fff;padding:6px 10px;text-align:left;font-weight:600}
td{padding:5px 10px;border:1px solid #${f.tblBorder}}
tr:nth-child(even) td{background:#${f.tblEven}}
blockquote{
  border-left:4px solid #${f.accent};
  background:#${f.quoteBg};padding:6px 12px;
  margin:8px 0;font-style:italic;color:#555;
  border-radius:0 3px 3px 0;
}
</style></head><body>
<h1>年度工作总结报告</h1>
<h2>一、工作概述</h2>
<p>本年度各项工作稳步推进，整体完成情况良好。团队协作顺畅，项目指标均达到预期目标，部分核心指标超额完成。</p>
<h3>1.1 主要成果</h3>
<p>全年累计完成项目 12 个，其中重点项目 4 个，新增合作伙伴 8 家，整体业务增长率达到 18.6%。</p>
<ul>
  <li>核心业务收入同比增长 23%</li>
  <li>客户满意度评分达 4.8 分（满分5分）</li>
  <li>团队规模扩大至 45 人</li>
</ul>
<h2>二、数据汇总</h2>
<table>
  <thead><tr><th>指标</th><th>目标值</th><th>实际值</th><th>完成率</th></tr></thead>
  <tbody>
    <tr><td>营业收入</td><td>1000万</td><td>1186万</td><td>118.6%</td></tr>
    <tr><td>新增客户</td><td>50家</td><td>63家</td><td>126%</td></tr>
    <tr><td>项目交付</td><td>10个</td><td>12个</td><td>120%</td></tr>
  </tbody>
</table>
<blockquote>重点说明：Q4 超额完成主要得益于新市场开拓策略的有效落地。</blockquote>
<h2>三、下一步计划</h2>
<p>持续深化核心业务布局，加大研发投入，预计明年实现营收增长 30% 以上，并拓展至 3 个新区域市场。</p>
</body></html>`;
});

// 监听 editForm 变化实时刷新预览（已通过 computed previewHtml 自动响应）
watch(editingId, (id) => selectEdit(id));

// ── 生命周期 ──────────────────────────────────────────────────────────────
onMounted(async () => {
  const status = await window.electronAPI.getDataPathStatus();
  dataDir.value = status.dataDir || '';
  try { machineId.value = await window.electronAPI.getmac(); } catch {}
  try {
    const s = await window.electronAPI.getAllSettings();
    proxyEnabled.value = s.proxyEnabled ?? false;
    proxyMode.value = s.proxyMode || 'global';
    proxyUrl.value = s.proxyUrl ?? '';
    customizations.value = s.templateCustomizations || {};
    activeTemplateId.value = s.activeTemplateId || 'business';
    browserExePath.value = s.browserExePath ?? '';
    browserUserDataDir.value = s.browserUserDataDir ?? '';
    userAvatar.value = s.userAvatar || '';
    userNickname.value = s.userNickname || '🙂AI助手🙂';
  } catch {}
  try {
    const defaults = await window.electronAPI.getBrowserDefaults();
    detectedExePath.value = defaults.exePath || '';
    detectedUserDataDir.value = defaults.userDataDir || '';
  } catch {}
  updateActiveProxy();
  try {
    pacListInfo.value = await window.electronAPI.getPacListInfo();
    const custom = await window.electronAPI.getPacCustomDomains();
    forceProxyDomains.value = custom.forceProxy || [];
    forceDirectDomains.value = custom.forceDirect || [];
    if (proxyEnabled.value && proxyMode.value === 'pac') ensurePacListIfNeeded();
  } catch {}
  // 初始化编辑表单
  selectEdit('business');
});

function updateActiveProxy() {
  if (!proxyEnabled.value || proxyMode.value === 'direct') {
    activeProxy.value = '';
  } else if (proxyMode.value === 'pac' && proxyUrl.value) {
    activeProxy.value = `PAC 模式：${proxyUrl.value}`;
  } else if (proxyMode.value === 'global' && proxyUrl.value) {
    activeProxy.value = `全局代理：${proxyUrl.value}`;
  } else if (proxyEnabled.value) {
    activeProxy.value = '未填写代理地址';
  }
}

async function saveProxy() {
  saving.value = true;
  try {
    await window.electronAPI.setSetting('proxyEnabled', proxyEnabled.value);
    await window.electronAPI.setSetting('proxyMode', proxyMode.value);
    await window.electronAPI.setSetting('proxyUrl', proxyUrl.value);
    updateActiveProxy();
    ElMessage.success('代理配置已保存，新的联网搜索会立即使用');
    if (proxyEnabled.value && proxyMode.value === 'pac') {
      ensurePacListIfNeeded();
    }
  } catch {
    ElMessage.error('保存失败');
  } finally {
    saving.value = false;
  }
}

// 切到 PAC 模式后：数据目录下没有名单就自动下载一次；已存在则不重复请求
async function ensurePacListIfNeeded() {
  if (pacListInfo.value.source === 'remote' || updatingList.value) return;
  updatingList.value = true;
  pacListInfo.value = { ...pacListInfo.value, fetching: true };
  try {
    const result = await window.electronAPI.ensurePacListReady();
    if (result.success) {
      pacListInfo.value = await window.electronAPI.getPacListInfo();
      if (!result.alreadyReady) ElMessage.success('PAC 名单已下载完成');
    } else {
      pacListInfo.value = { ...pacListInfo.value, fetching: false };
      ElMessage.warning(`名单下载失败：${result.error}，当前会先按默认走代理处理`);
    }
  } catch {
    pacListInfo.value = { ...pacListInfo.value, fetching: false };
  } finally {
    updatingList.value = false;
  }
}

async function testProxy() {
  testing.value = true;
  try {
    const result = await window.electronAPI.testProxy(proxyUrl.value, proxyMode.value);
    if (result.success) ElMessage.success(`连接成功，延迟约 ${result.latency}ms`);
    else ElMessage.error(`连接失败：${result.error}`);
  } catch {
    ElMessage.error('测试失败，请检查代理地址格式');
  } finally {
    testing.value = false;
  }
}

function formatPacTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

async function updatePacList() {
  updatingList.value = true;
  try {
    const result = await window.electronAPI.updatePacList();
    if (result.success) {
      pacListInfo.value = { ...result.meta, source: 'remote', fetching: false };
      ElMessage.success(`名单已更新，共 ${result.meta.count.toLocaleString()} 条`);
    } else {
      ElMessage.error(`更新失败：${result.error}`);
    }
  } catch {
    ElMessage.error('更新失败，请检查网络或代理设置');
  } finally {
    updatingList.value = false;
  }
}

async function addDomain(type) {
  const input = type === 'proxy' ? forceProxyInput : forceDirectInput;
  const list = type === 'proxy' ? forceProxyDomains : forceDirectDomains;
  const value = input.value.trim().toLowerCase();
  input.value = '';
  if (!value || list.value.includes(value)) return;
  const next = [...list.value, value];
  list.value = next;
  await persistDomainList(type, next);
}

async function removeDomain(type, domain) {
  const list = type === 'proxy' ? forceProxyDomains : forceDirectDomains;
  const next = list.value.filter((d) => d !== domain);
  list.value = next;
  await persistDomainList(type, next);
}

// domains 必须传纯数组：如果重新读 ref.value 拿到的是响应式 Proxy，
// 会导致 ipcRenderer.invoke 结构化克隆失败（"An object could not be cloned"）
async function persistDomainList(type, domains) {
  try {
    if (type === 'proxy') await window.electronAPI.setPacForceProxyDomains(domains);
    else await window.electronAPI.setPacForceDirectDomains(domains);
  } catch (e) {
    console.error('[PAC] 保存自定义域名失败:', e);
    ElMessage.error(`保存失败：${e?.message || e}`);
  }
}

function triggerAvatarSelect() {
  avatarInputRef.value?.click();
}

function resizeImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onAvatarChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件');
    return;
  }
  try {
    const dataUrl = await resizeImageToDataUrl(file, 200);
    userAvatar.value = dataUrl;
    await window.electronAPI.setSetting('userAvatar', dataUrl);
    ElMessage.success('头像已更新');
  } catch {
    ElMessage.error('头像处理失败');
  }
}

async function resetAvatar() {
  userAvatar.value = '';
  try {
    await window.electronAPI.setSetting('userAvatar', '');
    ElMessage.success('已恢复默认头像');
  } catch {
    ElMessage.error('保存失败');
  }
}

async function saveNickname() {
  try {
    await window.electronAPI.setSetting('userNickname', userNickname.value);
    ElMessage.success('昵称已保存');
  } catch {
    ElMessage.error('保存失败');
  }
}

function changeDataDir() {
  router.push('/setup');
}

async function openDataDir() {
  if (!dataDir.value) return;
  const res = await window.electronAPI.openPath(dataDir.value);
  if (!res?.success) ElMessage.error(`打开目录失败：${res?.error || '未知错误'}`);
}

async function selectBrowserExe() {
  const path = await window.electronAPI.selectBrowserExe();
  if (path) browserExePath.value = path;
}

async function selectBrowserUserDataDir() {
  const dir = await window.electronAPI.selectBrowserUserDataDir();
  if (dir) browserUserDataDir.value = dir;
}

async function saveBrowserConfig() {
  savingBrowser.value = true;
  try {
    await window.electronAPI.setSetting('browserExePath', browserExePath.value);
    await window.electronAPI.setSetting('browserUserDataDir', browserUserDataDir.value);
    ElMessage.success('浏览器配置已保存');
  } catch {
    ElMessage.error('保存失败');
  } finally {
    savingBrowser.value = false;
  }
}
</script>

<style scoped lang="scss">
.page-wrap {
  width: 100%;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.setting-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgba(10, 20, 40, 0.55);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* ── 左侧菜单 ── */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 16px 0 0 16px;
  padding: 28px 0 20px;
  display: flex;
  flex-direction: column;
}

.sidebar-title {
  font-size: 15px;
  font-weight: 700;
  color: #f1f5f9;
  padding: 0 20px 20px;
  letter-spacing: 1px;
}

.menu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 10px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s;
  color: #64748b;
  font-size: 14px;

  .menu-icon { font-size: 16px; }

  &:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #cbd5e1;
  }

  &.active {
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
    font-weight: 600;
  }
}

/* ── 右侧内容 ── */
.content {
  flex: 1;
  padding: 28px 32px;
  overflow-y: auto;
  min-width: 0;
}

.content-header { margin-bottom: 16px; }
.content-title { font-size: 17px; font-weight: 700; color: #f1f5f9; margin: 0 0 4px; }
.content-desc  { font-size: 13px; color: #94a3b8; margin: 0; }
.content-divider { height: 1px; background: rgba(255,255,255,0.07); margin-bottom: 24px; }

.row-with-btn { display: flex; width: 100%; gap: 8px; align-items: center; }

.avatar-edit-row { display: flex; align-items: center; gap: 14px; }

.avatar-wrap {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.avatar-preview { width: 100%; height: 100%; object-fit: cover; display: block; }

.avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.avatar-wrap:hover .avatar-mask { opacity: 1; }

.tip { font-size: 12px; color: #94a3b8; margin-top: 4px; line-height: 1.6; }

.domain-tag-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%; }
.domain-input { width: 200px; }

/* ── 报告模板 ── */
.tpl-section { display: flex; flex-direction: column; gap: 20px; }

/* 5个模板选卡 */
.tpl-sel-row {
  display: flex;
  gap: 10px;
}

.tpl-sel-card {
  flex: 1;
  padding: 12px 10px 10px;
  border-radius: 10px;
  border: 2px solid rgba(255,255,255,0.1);
  cursor: pointer;
  text-align: center;
  transition: all 0.18s;
  background: rgba(255,255,255,0.03);
  position: relative;

  &:hover { border-color: rgba(56,189,248,0.4); background: rgba(56,189,248,0.05); }
  &.editing { border-color: #38bdf8; background: rgba(56,189,248,0.1); }
  &.inuse { border-color: #22c55e !important; }
}

.tpl-inuse-badge {
  position: absolute;
  top: -1px; right: -1px;
  background: #22c55e;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 0 8px 0 6px;
  line-height: 18px;
}

.tpl-dots {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-bottom: 8px;

  .dot {
    width: 14px; height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.2);
    display: inline-block;
  }
}

.tpl-sel-name {
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;

  .tpl-sel-card.active & { color: #38bdf8; }
}

/* 主体：编辑 + 预览 */
.tpl-body {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  //height: 480px;
  overflow: hidden;
}

/* 属性编辑区 */
.tpl-editor {
  width: 240px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.editor-title {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 14px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);

  &:last-of-type { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    width: 64px;
    flex-shrink: 0;
    font-size: 12px;
    color: #64748b;
  }
}

.color-row {
  display: flex;
  align-items: center;
  gap: 6px;

  input[type="color"] {
    width: 28px;
    height: 22px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    cursor: pointer;
    padding: 1px;
    background: transparent;
  }
}

.hex {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

.sel {
  flex: 1;
  height: 26px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  color: #cbd5e1;
  font-size: 12px;
  padding: 0 6px;
  cursor: pointer;
  outline: none;

  option { background: #1e293b; color: #cbd5e1; }
  &:focus { border-color: rgba(56,189,248,0.5); }
}

.editor-actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.06);
  .el-button { flex: 1; font-size: 12px; padding: 6px 4px; }
}

/* 预览区 */
.tpl-preview-wrap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.preview-scaler-wrap {
  flex: 1;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.preview-iframe {
  width: 100%;
  height: 1123px;
  border: none;
  // zoom: 0.62;   /* layout 492px × 697px */
  pointer-events: none;
  display: block;
}

/* ── Element Plus 暗色覆盖 ── */
:deep(.dark-form) {
  .el-form-item__label { color: #94a3b8; font-size: 13px; }

  .el-input__wrapper {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: none;
    &:hover { border-color: rgba(56,189,248,0.4); }
    &.is-focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.15); }
  }

  .el-input__inner {
    color: #e2e8f0;
    background: transparent;
    &::placeholder { color: #475569; }
  }

  .el-input.is-disabled .el-input__wrapper { background: rgba(255,255,255,0.02); opacity: 0.5; }

  .el-radio-button__inner {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.12);
    color: #cbd5e1;
  }

  .el-radio-button__original-radio:checked + .el-radio-button__inner {
    background: linear-gradient(135deg, #38bdf8, #818cf8);
    border-color: transparent;
    color: #fff;
    box-shadow: none;
  }

  .el-button {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #cbd5e1;
    &:hover { border-color: rgba(56,189,248,0.4); color: #38bdf8; }
  }

  .el-button--primary {
    background: linear-gradient(135deg, #38bdf8, #818cf8);
    border: none;
    color: #fff;
    &:hover { opacity: 0.85; }
  }

  .el-switch.is-checked .el-switch__core { background: #38bdf8; border-color: #38bdf8; }
}
</style>
