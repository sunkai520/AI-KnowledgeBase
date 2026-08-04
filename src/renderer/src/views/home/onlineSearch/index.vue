<template>
  <div class="online-search">
    <div class="page-ai-bg" aria-hidden="true">
      <div class="ai-blob ai-blob--1"></div>
      <div class="ai-blob ai-blob--2"></div>
      <div class="ai-blob ai-blob--3"></div>
      <div class="ai-grid"></div>
      <div class="ai-scanline"></div>
    </div>

    <section v-if="!currentEngine" class="engine-home">
      <div v-if="visibleEngines.length" class="site-section">
        <div class="section-title">搜索引擎</div>
        <div class="engine-grid">
          <div
            v-for="engine in visibleEngines"
            :key="engine.key"
            class="engine-card"
            role="button"
            tabindex="0"
            @click="openEngine(engine)"
            @keydown.enter.prevent="openEngine(engine)"
            @keydown.space.prevent="openEngine(engine)"
          >
            <span class="engine-icon" :style="{ color: engine.color }">{{ engine.icon }}</span>
            <span class="engine-info">
              <strong>{{ engine.name }}</strong>
              <small>搜索入口</small>
            </span>
          </div>
        </div>
      </div>

      <div class="shortcut-section">
        <div
          v-for="site in favoriteSites"
          :key="`favorite-${site.key}`"
          class="shortcut-item"
          role="button"
          tabindex="0"
          @click="openEngine(site)"
          @keydown.enter.prevent="openEngine(site)"
          @keydown.space.prevent="openEngine(site)"
        >
          <button
            class="shortcut-remove"
            type="button"
            title="删除快捷方式"
            @click.stop="removeFavoriteSite(site.key)"
          >
            ×
          </button>
          <span class="shortcut-icon" :style="{ color: site.color }">{{ site.icon }}</span>
          <span class="shortcut-name">{{ site.name }}</span>
        </div>
        <button class="shortcut-item add-shortcut" type="button" @click="showAddSiteDialog">
          <span class="shortcut-icon">+</span>
          <span class="shortcut-name">添加快捷方式</span>
        </button>
      </div>

      <div class="ai-showcase" aria-hidden="true">
        <div class="ai-portal">
          <span class="ai-ring ai-ring--1"></span>
          <span class="ai-ring ai-ring--2"></span>
          <span class="ai-ring ai-ring--3"></span>
          <canvas ref="tunnelCanvasRef" class="ai-tunnel"></canvas>
          <span class="ai-core-glow"></span>
        </div>

        <div class="ai-tagline">
          <span class="ai-tagline-title">AI 智能联网搜索</span>
          <span class="ai-tagline-sub">多引擎聚合 · 实时检索 · 让信息触手可及</span>
        </div>
      </div>

    </section>

    <section v-else class="browser-panel">
      <div class="tab-strip">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['browser-tab', { active: tab.id === activeTabId }]"
          type="button"
          @click="activateTab(tab.id)"
        >
          <span class="tab-title">{{ tab.title || "新标签页" }}</span>
          <span v-if="tab.loading" class="tab-loading"></span>
          <span
            v-if="tabs.length > 1"
            class="tab-close"
            @click.stop="closeTab(tab.id)"
          >
            ×
          </span>
        </button>
        <button class="new-tab-btn" type="button" title="新建标签页" @click="openNewTab">+</button>
      </div>

      <div class="browser-toolbar">
        <button class="toolbar-icon-btn" type="button" title="后退" @click="goBack">
          <el-icon><Back /></el-icon>
        </button>
        <button class="toolbar-icon-btn" type="button" title="前进" @click="goForward">
          <el-icon><Right /></el-icon>
        </button>
        <button class="toolbar-icon-btn" type="button" title="刷新" @click="reload">
          <el-icon><Refresh /></el-icon>
        </button>
        <el-input
          v-model="activeAddress"
          class="address-input"
          @keydown.enter.prevent="navigateAddress"
        />
        <button
          :class="['toolbar-star-btn', { active: isCurrentPageFavorite }]"
          type="button"
          :title="isCurrentPageFavorite ? '取消收藏' : '收藏当前网站'"
          @click="toggleCurrentPageFavorite"
        >
          <el-icon>
            <StarFilled v-if="isCurrentPageFavorite" />
            <Star v-else />
          </el-icon>
        </button>
        <span :class="['proxy-chip', proxyState.mode]">
          {{ proxyLabel }}
        </span>
      </div>

      <div v-if="findOpen" class="find-bar">
        <el-input
          ref="findInputRef"
          v-model="findKeyword"
          class="find-input"
          placeholder="搜索当前页面"
          @input="startFind"
          @keydown.enter.prevent="findNext($event.shiftKey)"
          @keydown.esc.prevent="closeFindBar"
        />
        <span class="find-count">{{ findCountLabel }}</span>
        <el-button class="find-btn" @click="findNext(true)">上一个</el-button>
        <el-button class="find-btn" @click="findNext(false)">下一个</el-button>
        <button class="find-close" type="button" @click="closeFindBar">×</button>
      </div>

      <div class="webview-stack">
        <webview
          v-for="tab in tabs"
          :key="tab.id"
          :ref="getWebviewRefSetter(tab.id)"
          :class="['search-webview', { active: tab.id === activeTabId }]"
          partition="persist:online-search"
          :src="tab.url"
          allowpopups
          @did-start-loading="tab.loading = true"
          @did-stop-loading="tab.loading = false"
          @did-navigate="(event) => syncAddress(tab.id, event)"
          @did-navigate-in-page="(event) => syncAddress(tab.id, event)"
          @did-fail-load="(event) => handleLoadFail(tab.id, event)"
          @page-title-updated="(event) => syncTitle(tab.id, event)"
        />
      </div>
    </section>

    <el-dialog
      v-model="addSiteDialogVisible"
      title="添加网站"
      width="420px"
      append-to-body
      class="site-dialog"
    >
      <el-form class="site-form" label-width="76px">
        <el-form-item label="名称">
          <el-input v-model="siteForm.name" placeholder="例如：知乎" maxlength="20" />
        </el-form-item>
        <el-form-item label="网址">
          <el-input v-model="siteForm.url" placeholder="https://www.example.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button class="site-dialog-cancel" @click="addSiteDialogVisible = false">取消</el-button>
        <el-button class="site-dialog-confirm" type="primary" @click="saveCustomSite">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="aiAnalysisVisible"
      title="AI 分析"
      width="80%"
      align-center
      append-to-body
      class="site-dialog ai-analysis-dialog"
    >
      <div class="ai-analysis-body">
        <div v-if="aiAnalysisError" class="ai-analysis-error">{{ aiAnalysisError }}</div>
        <div v-else v-loading="aiAnalysisLoading" element-loading-text="AI 正在阅读并总结当前页面…" class="ai-analysis-result">
          <h3 v-if="aiAnalysisTitle" class="ai-analysis-title">{{ aiAnalysisTitle }}</h3>
          <p v-if="aiAnalysisContent" class="ai-analysis-content">{{ aiAnalysisContent }}</p>
        </div>
      </div>
      <template #footer>
        <el-button class="site-dialog-cancel" @click="aiAnalysisVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Back, Refresh, Right, Star, StarFilled } from "@element-plus/icons-vue";

const engines = [
  {
    key: "google",
    name: "Google",
    icon: "G",
    color: "#2563eb",
    url: "https://www.google.com/",
    proxy: true,
  },
  {
    key: "bing",
    name: "Bing",
    icon: "B",
    color: "#0f766e",
    url: "https://www.bing.com/",
    proxy: true,
  },
  {
    key: "baidu",
    name: "百度",
    icon: "百",
    color: "#1d4ed8",
    url: "https://www.baidu.com/",
    proxy: false,
  },
  {
    key: "duckduckgo",
    name: "DuckDuckGo",
    icon: "D",
    color: "#de5833",
    url: "https://duckduckgo.com/",
    proxy: true,
  },
  {
    key: "sogou",
    name: "搜狗",
    icon: "狗",
    color: "#f97316",
    url: "https://www.sogou.com/",
    proxy: false,
  },
];

const STORAGE_KEYS = {
  customSites: "onlineSearch:customSites",
  favorites: "onlineSearch:favorites",
};

const tabs = ref([]);
const activeTabId = ref("");
const currentEngine = ref(null);
const customSites = ref([]);
const favoriteItems = ref([]);
const addSiteDialogVisible = ref(false);
const siteForm = ref({ name: "", url: "" });
const proxyState = ref({ mode: "direct", proxyUrl: "" });
const findOpen = ref(false);
const findKeyword = ref("");
const findState = ref({ active: 0, total: 0 });
const findInputRef = ref(null);
const webviewRefs = new Map();
const webviewListeners = new Map();
const webviewRefSetters = new Map();
const aiAnalysisVisible = ref(false);
const aiAnalysisLoading = ref(false);
const aiAnalysisTitle = ref("");
const aiAnalysisContent = ref("");
const aiAnalysisError = ref("");
let removeOpenFindListener = null;
let removeOpenNewTabListener = null;
let removeAiAnalyzeListener = null;
let lastPopupUrl = "";
let lastPopupAt = 0;

const allSites = computed(() => [...engines, ...customSites.value]);
const favoriteSites = computed(() => favoriteItems.value);
const visibleEngines = computed(() => engines);

const currentTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) || null);
const activeAddress = computed({
  get: () => currentTab.value?.address || "",
  set: (value) => {
    if (currentTab.value) currentTab.value.address = value;
  },
});

const currentPageFavorite = computed(() => findFavoriteByUrl(activeAddress.value));
const isCurrentPageFavorite = computed(() => {
  return Boolean(currentPageFavorite.value);
});

const findCountLabel = computed(() => {
  if (!findKeyword.value) return "";
  if (!findState.value.total) return "0/0";
  return `${findState.value.active}/${findState.value.total}`;
});

const proxyLabel = computed(() => {
  if (proxyState.value.mode === "pac") return "PAC";
  if (proxyState.value.mode === "proxy") return "代理";
  return "直连";
});

async function openEngine(engine) {
  try {
    proxyState.value = await window.electronAPI.configureOnlineSearchProxy(engine.key);
  } catch (err) {
    proxyState.value = { mode: "direct", proxyUrl: "" };
    ElMessage.warning(err?.message || "代理配置失败，已尝试直连");
  }
  currentEngine.value = engine;
  tabs.value = [];
  createTab(engine.url, engine.name);
}

function showAddSiteDialog() {
  siteForm.value = { name: "", url: "" };
  addSiteDialogVisible.value = true;
}

function removeFavoriteSite(key) {
  const removedSite = favoriteItems.value.find((item) => item.key === key);
  favoriteItems.value = favoriteItems.value.filter((item) => item.key !== key);
  if (removedSite?.custom) {
    customSites.value = customSites.value.filter((site) => site.key !== key);
  }
  saveSiteState();
}

function toggleCurrentPageFavorite() {
  const url = normalizeUrl(activeAddress.value || currentTab.value?.url || currentEngine.value?.url);
  if (!isValidHttpUrl(url)) {
    ElMessage.warning("当前页面无法收藏");
    return;
  }

  const existingFavorite = findFavoriteByUrl(url);
  if (existingFavorite?.key) {
    removeFavoriteSite(existingFavorite.key);
    return;
  }

  const favorite = createFavoriteFromCurrentPage(url);
  favoriteItems.value = [...favoriteItems.value, favorite];
  saveSiteState();
  ElMessage.success("已收藏当前网站");
}

function saveCustomSite() {
  const name = siteForm.value.name.trim();
  const url = normalizeUrl(siteForm.value.url);
  if (!name) {
    ElMessage.warning("请填写网站名称");
    return;
  }
  if (!isValidHttpUrl(url)) {
    ElMessage.warning("请填写正确的网址");
    return;
  }
  if (allSites.value.some((site) => site.url.replace(/\/$/, "") === url.replace(/\/$/, ""))) {
    ElMessage.warning("这个网站已经存在");
    return;
  }

  const site = {
    key: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    icon: name.slice(0, 1).toUpperCase(),
    color: pickSiteColor(name),
    url,
    proxy: false,
    custom: true,
  };
  customSites.value = [...customSites.value, site];
  favoriteItems.value = [...favoriteItems.value, site];
  saveSiteState();
  addSiteDialogVisible.value = false;
  ElMessage.success("网站已添加");
}

function findFavoriteByUrl(value) {
  const target = getUrlComparable(value);
  if (!target) return null;
  return favoriteItems.value.find((site) => getUrlComparable(site.url) === target) || null;
}

function getUrlComparable(value) {
  try {
    const url = new URL(normalizeUrl(value));
    const pathname = url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathname}${url.search}`;
  } catch {
    return "";
  }
}

function createFavoriteFromCurrentPage(url) {
  const parsedUrl = new URL(normalizeUrl(url));
  const host = parsedUrl.hostname.replace(/^www\./, "");
  const title = currentTab.value?.title?.trim();
  const name = title && title !== "新标签页" ? title : host.split(".")[0] || host;
  return {
    key: `favorite-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    icon: name.slice(0, 1).toUpperCase(),
    color: pickSiteColor(name),
    url: parsedUrl.href,
    proxy: false,
  };
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function pickSiteColor(seed = "") {
  const colors = ["#2563eb", "#0f766e", "#7c3aed", "#dc2626", "#0891b2", "#ca8a04"];
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[total % colors.length];
}

function loadSiteState() {
  try {
    const savedSites = JSON.parse(localStorage.getItem(STORAGE_KEYS.customSites) || "[]");
    const savedFavorites = JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || "[]");
    customSites.value = Array.isArray(savedSites)
      ? savedSites.filter((site) => site?.key && site?.name && isValidHttpUrl(site?.url))
      : [];
    favoriteItems.value = normalizeSavedFavorites(savedFavorites);
  } catch {
    customSites.value = [];
    favoriteItems.value = [];
  }
}

function saveSiteState() {
  localStorage.setItem(STORAGE_KEYS.customSites, JSON.stringify(customSites.value));
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(favoriteItems.value));
}

function normalizeSavedFavorites(savedFavorites) {
  if (!Array.isArray(savedFavorites)) return [];
  return savedFavorites
    .map((item) => {
      if (typeof item === "string") {
        const site = allSites.value.find((candidate) => candidate.key === item);
        return site ? { ...site, url: normalizeUrl(site.url) } : null;
      }
      if (item?.key && item?.name && isValidHttpUrl(item?.url)) {
        return { ...item, url: normalizeUrl(item.url) };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function createTab(url, title = "新标签页") {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;
  const tab = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    url: normalizedUrl,
    address: normalizedUrl,
    loading: false,
  };
  tabs.value.push(tab);
  activeTabId.value = tab.id;
  return tab;
}

function getTab(tabId = activeTabId.value) {
  return tabs.value.find((tab) => tab.id === tabId) || null;
}

function getWebview(tabId = activeTabId.value) {
  return webviewRefs.get(tabId) || null;
}

function setWebviewRef(tabId, el) {
  if (!el) {
    unbindWebviewListeners(tabId);
    webviewRefs.delete(tabId);
    return;
  }
  webviewRefs.set(tabId, el);
  bindWebviewListeners(tabId, el);
}

// 复用同一个 tabId 对应的 ref 回调，避免模板中的内联箭头函数在每次重渲染时
// 产生新引用，导致 Vue 反复 unbind/rebind webview 上的 found-in-page 等监听器。
function getWebviewRefSetter(tabId) {
  let setter = webviewRefSetters.get(tabId);
  if (!setter) {
    setter = (el) => setWebviewRef(tabId, el);
    webviewRefSetters.set(tabId, setter);
  }
  return setter;
}

function bindWebviewListeners(tabId, webview) {
  if (!webview || webviewListeners.get(tabId)?.webview === webview) return;
  unbindWebviewListeners(tabId);
  const listeners = {
    webview,
    newWindow: handleNewWindow,
    foundInPage: (event) => handleFoundInPage(tabId, event),
  };
  webview.addEventListener?.("new-window", listeners.newWindow);
  webview.addEventListener?.("found-in-page", listeners.foundInPage);
  webviewListeners.set(tabId, listeners);
}

function unbindWebviewListeners(tabId) {
  const listeners = webviewListeners.get(tabId);
  if (!listeners) return;
  listeners.webview.removeEventListener?.("new-window", listeners.newWindow);
  listeners.webview.removeEventListener?.("found-in-page", listeners.foundInPage);
  webviewListeners.delete(tabId);
}

function navigateAddress() {
  navigateTo(activeAddress.value);
}

function navigateTo(url, tabId = activeTabId.value) {
  const tab = getTab(tabId);
  const normalizedUrl = normalizeUrl(url);
  if (!tab || !normalizedUrl) return;
  tab.url = normalizedUrl;
  tab.address = normalizedUrl;
  getWebview(tabId)?.loadURL?.(normalizedUrl);
}

function activateTab(tabId) {
  activeTabId.value = tabId;
  findState.value = { active: 0, total: 0 };
  if (findOpen.value && findKeyword.value) {
    nextTick(() => startFind());
  }
}

function openNewTab() {
  createTab(currentEngine.value?.url || "https://www.baidu.com", "新标签页");
}

function closeTab(tabId) {
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  unbindWebviewListeners(tabId);
  webviewRefs.delete(tabId);
  webviewRefSetters.delete(tabId);
  tabs.value.splice(index, 1);
  if (!tabs.value.length) {
    backHome();
    return;
  }
  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value[Math.max(0, index - 1)].id;
  }
}

function goBack() {
  getWebview()?.goBack?.();
}

function goForward() {
  getWebview()?.goForward?.();
}

function reload() {
  getWebview()?.reload?.();
}

function syncAddress(tabId, event) {
  const tab = getTab(tabId);
  if (!tab) return;
  // 只更新地址栏展示用的 address，不要回写驱动 webview :src 的 url，
  // 否则会形成"导航 -> 回写 url -> :src 变化 -> 再次加载"的二次刷新。
  const url = event?.url || getWebview(tabId)?.getURL?.() || tab.address;
  tab.address = url;
}

function syncTitle(tabId, event) {
  const tab = getTab(tabId);
  if (!tab) return;
  const title = String(event?.title || "").trim();
  if (title) tab.title = title;
}

function handleLoadFail(tabId, event) {
  const tab = getTab(tabId);
  if (tab) tab.loading = false;
  if (event?.errorCode === -3) return;
  ElMessage.warning(event?.errorDescription || "页面加载失败");
}

function handleNewWindow(event) {
  event?.preventDefault?.();
  const url = event?.url || event?.detail?.url;
  openPopupTab(url);
}

function openPopupTab(url) {
  if (!url || !currentEngine.value) return;
  const now = Date.now();
  if (url === lastPopupUrl && now - lastPopupAt < 800) return;
  lastPopupUrl = url;
  lastPopupAt = now;
  createTab(url, getTabTitleFromUrl(url));
}

function getTabTitleFromUrl(url) {
  try {
    return new URL(normalizeUrl(url)).hostname || "新标签页";
  } catch {
    return "新标签页";
  }
}

function openFindBar() {
  if (!currentTab.value) return;
  findOpen.value = true;
  nextTick(() => {
    findInputRef.value?.focus?.();
    findInputRef.value?.select?.();
    if (findKeyword.value) startFind();
  });
}

function closeFindBar() {
  getWebview()?.stopFindInPage?.("clearSelection");
  findOpen.value = false;
  findKeyword.value = "";
  findState.value = { active: 0, total: 0 };
}

function startFind() {
  const keyword = findKeyword.value.trim();
  const webview = getWebview();
  if (!webview) return;
  if (!keyword) {
    webview.stopFindInPage?.("clearSelection");
    findState.value = { active: 0, total: 0 };
    return;
  }
  webview.findInPage?.(keyword, { forward: true, findNext: true });
}

function findNext(backward = false) {
  const keyword = findKeyword.value.trim();
  const webview = getWebview();
  if (!webview || !keyword) return;
  webview.findInPage?.(keyword, { forward: !backward, findNext: true });
}

function handleFoundInPage(tabId, event) {
  const result = event?.result || event?.detail?.result || {};
  if (tabId !== activeTabId.value) return;
  findState.value = {
    active: result.activeMatchOrdinal || 0,
    total: result.matches || 0,
  };
}

function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === "f") {
    event.preventDefault();
    openFindBar();
    return;
  }
  if (event.key === "Escape" && findOpen.value) {
    event.preventDefault();
    closeFindBar();
  }
}

function handleOuterBack(event) {
  if (!currentEngine.value) return;
  event?.preventDefault?.();
  backHome();
}

async function backHome() {
  closeFindBar();
  tabs.value.forEach((tab) => {
    unbindWebviewListeners(tab.id);
    webviewRefs.delete(tab.id);
    webviewRefSetters.delete(tab.id);
  });
  currentEngine.value = null;
  activeTabId.value = "";
  tabs.value = [];
  proxyState.value = { mode: "direct", proxyUrl: "" };
  await window.electronAPI.clearOnlineSearchProxy?.();
}

function handleAiAnalyzeEvent(payload) {
  const status = payload?.status;
  if (status === "loading") {
    aiAnalysisVisible.value = true;
    aiAnalysisLoading.value = true;
    aiAnalysisError.value = "";
    aiAnalysisTitle.value = "";
    aiAnalysisContent.value = "";
    return;
  }
  if (status === "streaming") {
    if (payload?.title || payload?.content) {
      aiAnalysisLoading.value = false;
    }
    aiAnalysisTitle.value = payload?.title || "";
    aiAnalysisContent.value = payload?.content || "";
    return;
  }
  if (status === "done") {
    aiAnalysisLoading.value = false;
    aiAnalysisTitle.value = payload?.title || "AI 总结";
    aiAnalysisContent.value = payload?.content || "";
    return;
  }
  if (status === "error") {
    aiAnalysisLoading.value = false;
    aiAnalysisError.value = payload?.message || "AI 分析失败，请稍后重试";
  }
}

onMounted(() => {
  loadSiteState();
  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("online-search:outer-back", handleOuterBack);
  removeOpenFindListener = window.electronAPI?.onOpenOnlineSearchFind?.(openFindBar) || null;
  removeOpenNewTabListener = window.electronAPI?.onOpenOnlineSearchNewTab?.(openPopupTab) || null;
  removeAiAnalyzeListener = window.electronAPI?.onOnlineSearchAiAnalyze?.(handleAiAnalyzeEvent) || null;
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown, true);
  window.removeEventListener("online-search:outer-back", handleOuterBack);
  removeOpenFindListener?.();
  removeOpenNewTabListener?.();
  removeAiAnalyzeListener?.();
  tabs.value.forEach((tab) => unbindWebviewListeners(tab.id));
  window.electronAPI.clearOnlineSearchProxy?.();
  stopTunnelLoop();
});

// ── 空白区域的"时光隧道"粒子动画 ──────────────────────────────────────────
const tunnelCanvasRef = ref(null);
let tunnelAnimationFrame = null;
let tunnelResizeObserver = null;
let tunnelParticles = [];

const TUNNEL_COLORS = ["#38bdf8", "#818cf8", "#2dd4bf"];

function resetTunnelParticle(p) {
  p.angle = Math.random() * Math.PI * 2;
  p.dist = Math.random() * 0.08;
  p.speed = 0.15 + Math.random() * 0.25;
  p.color = TUNNEL_COLORS[Math.floor(Math.random() * TUNNEL_COLORS.length)];
  p.size = 1 + Math.random() * 1.6;
}

function initTunnelParticles(count) {
  tunnelParticles = Array.from({ length: count }, () => {
    const p = { angle: 0, dist: Math.random(), speed: 0, color: "", size: 0 };
    resetTunnelParticle(p);
    p.dist = Math.random(); // 初始散布在整个盘面，避免全部粒子同时从中心涌出
    return p;
  });
}

function drawTunnelFrame(canvas, ctx, animate) {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.min(w, h) / 2;

  ctx.clearRect(0, 0, w, h);

  tunnelParticles.forEach((p) => {
    const prevDist = p.dist;
    if (animate) {
      p.dist += p.speed * 0.01 * (1 + p.dist * 3);
      if (p.dist > 1) resetTunnelParticle(p);
    }
    const dist = p.dist * maxDist;
    const prevD = prevDist * maxDist;
    const x = cx + Math.cos(p.angle) * dist;
    const y = cy + Math.sin(p.angle) * dist;
    const px = cx + Math.cos(p.angle) * prevD;
    const py = cy + Math.sin(p.angle) * prevD;

    ctx.strokeStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.dist * 1.4) * 0.9;
    ctx.lineWidth = p.size * (0.5 + p.dist * 1.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function startTunnelLoop() {
  const canvas = tunnelCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  resize();
  tunnelResizeObserver = new ResizeObserver(resize);
  tunnelResizeObserver.observe(canvas);

  initTunnelParticles(90);

  function loop() {
    if (!tunnelCanvasRef.value) return;
    drawTunnelFrame(canvas, ctx, !reduced);
    if (!reduced) tunnelAnimationFrame = requestAnimationFrame(loop);
  }
  loop();
}

function stopTunnelLoop() {
  if (tunnelAnimationFrame) cancelAnimationFrame(tunnelAnimationFrame);
  tunnelAnimationFrame = null;
  tunnelResizeObserver?.disconnect();
  tunnelResizeObserver = null;
}

watch(tunnelCanvasRef, (el) => {
  if (el) startTunnelLoop();
  else stopTunnelLoop();
});
</script>

<style scoped lang="scss">
.online-search {
  position: relative;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border-radius: 16px;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 15%, rgba(56, 189, 248, 0.14), transparent 45%),
    radial-gradient(circle at 88% 10%, rgba(129, 140, 248, 0.14), transparent 45%),
    radial-gradient(circle at 50% 100%, rgba(45, 212, 191, 0.12), transparent 55%),
    linear-gradient(180deg, #eef2ff 0%, #f8fafc 55%);
}

.page-ai-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.engine-home {
  position: relative;
  z-index: 1;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 4px;
}

.shortcut-section {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  min-height: 104px;
  padding: 4px 4px 10px;
  overflow-x: auto;
}

.shortcut-item {
  width: 94px;
  min-width: 94px;
  min-height: 86px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 8px 6px;
  color: #0f172a;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: 0.15s ease;
}

.shortcut-item:hover,
.shortcut-item:focus-visible {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.shortcut-icon {
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e5e7eb;
  font-size: 22px;
  font-weight: 900;
}

.shortcut-name {
  width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.shortcut-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #b91c1c;
  background: #ffffff;
  border: 1px solid #fecaca;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  opacity: 0;
  transition: 0.15s ease;
}

.shortcut-item:hover .shortcut-remove,
.shortcut-item:focus-within .shortcut-remove {
  opacity: 1;
}

.shortcut-remove:hover {
  color: #ffffff;
  background: #ef4444;
  border-color: #ef4444;
}

.add-shortcut .shortcut-icon {
  color: #1d4ed8;
  background: #dbeafe;
  font-size: 28px;
  font-weight: 400;
}

/* ── AI 科技感展示区（页面背景已全局铺开，这里只放剩余空白里的插画+文案）── */
.ai-showcase {
  position: relative;
  flex: 1;
  min-height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(50px);
  opacity: 0.5;
  pointer-events: none;
  animation: aiFloat 10s ease-in-out infinite;
}

.ai-blob--1 {
  width: 320px;
  height: 320px;
  left: -80px;
  top: -60px;
  background: rgba(56, 189, 248, 0.32);
  animation-delay: 0s;
}

.ai-blob--2 {
  width: 360px;
  height: 360px;
  right: -100px;
  top: -80px;
  background: rgba(129, 140, 248, 0.28);
  animation-delay: 2s;
}

.ai-blob--3 {
  width: 340px;
  height: 340px;
  left: 30%;
  bottom: -140px;
  background: rgba(45, 212, 191, 0.24);
  animation-delay: 4s;
}

@keyframes aiFloat {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(14px, -16px); }
}

.ai-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(99, 102, 241, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99, 102, 241, 0.05) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse at 50% 30%, #000 55%, transparent 92%);
}

.ai-scanline {
  position: absolute;
  left: 0;
  right: 0;
  height: 140px;
  background: linear-gradient(180deg, transparent, rgba(56, 189, 248, 0.1), transparent);
  pointer-events: none;
  animation: aiScan 9s linear infinite;
}

@keyframes aiScan {
  0% { top: -140px; }
  100% { top: 100%; }
}

.ai-portal {
  position: relative;
  width: min(320px, 70%);
  aspect-ratio: 1 / 1;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-tunnel {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ai-core-glow {
  position: absolute;
  width: 34%;
  height: 34%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(129, 140, 248, 0.85), rgba(129, 140, 248, 0.25) 55%, transparent 75%);
  filter: blur(2px);
  animation: aiCorePulse 2.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes aiCorePulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.12); opacity: 1; }
}

.ai-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
}

.ai-ring--1 {
  inset: 6%;
  border: 1px solid rgba(56, 189, 248, 0.35);
  animation: aiSpin 14s linear infinite;
}

.ai-ring--2 {
  inset: 16%;
  border: 1px dashed rgba(129, 140, 248, 0.35);
  animation: aiSpin 10s linear infinite reverse;
}

.ai-ring--3 {
  inset: 26%;
  border: 1px solid rgba(45, 212, 191, 0.3);
  animation: aiSpin 7s linear infinite;
}

@keyframes aiSpin {
  to { transform: rotate(360deg); }
}

.ai-tagline {
  position: absolute;
  bottom: 22px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 1;
  pointer-events: none;
}

.ai-tagline-title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.5px;
  background: linear-gradient(90deg, #2563eb, #7c3aed, #0d9488);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.ai-tagline-sub {
  font-size: 12px;
  color: #64748b;
}

@media (prefers-reduced-motion: reduce) {
  .ai-blob,
  .ai-scanline,
  .ai-ring,
  .ai-core-glow {
    animation: none;
  }
}

.site-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
}

.engine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 16px;
}

.engine-card {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  text-align: left;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  transition: 0.18s ease;
  position: relative;
}

.engine-card:hover {
  transform: translateY(-2px);
  border-color: #60a5fa;
  box-shadow: 0 16px 34px rgba(37, 99, 235, 0.16);
}

.engine-card:focus-visible {
  outline: 3px solid rgba(56, 189, 248, 0.25);
  border-color: #38bdf8;
}

.engine-icon {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 48px;
  border-radius: 12px;
  background: #eff6ff;
  font-size: 26px;
  font-weight: 900;
}

.engine-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.engine-info strong {
  font-size: 17px;
  color: #0f172a;
}

.engine-info small {
  color: #64748b;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-form :deep(.el-input__wrapper) {
  background: #ffffff !important;
  border: 1px solid #bfdbfe !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

.site-form :deep(.el-input__inner) {
  color: #0f172a !important;
}

:global(.site-dialog .el-dialog),
:global(.el-dialog.site-dialog) {
  background: #ffffff !important;
  border: 1px solid #bfdbfe !important;
  border-radius: 14px !important;
  box-shadow: 0 24px 56px rgba(15, 23, 42, 0.18) !important;
}

:global(.site-dialog .el-dialog__header),
:global(.el-dialog.site-dialog .el-dialog__header) {
  padding: 18px 22px 12px !important;
  border-bottom: 1px solid #e0ecff !important;
}

:global(.site-dialog .el-dialog__title),
:global(.el-dialog.site-dialog .el-dialog__title) {
  color: #0f172a !important;
  font-weight: 800 !important;
}

:global(.site-dialog .el-dialog__headerbtn .el-icon),
:global(.el-dialog.site-dialog .el-dialog__headerbtn .el-icon) {
  color: #64748b !important;
}

:global(.site-dialog .el-dialog__body),
:global(.el-dialog.site-dialog .el-dialog__body) {
  padding: 18px 22px 8px !important;
  color: #0f172a !important;
}

:global(.site-dialog .el-dialog__footer),
:global(.el-dialog.site-dialog .el-dialog__footer) {
  padding: 12px 22px 18px !important;
  border-top: 1px solid #e0ecff !important;
}

:global(.site-dialog .el-form-item__label),
:global(.el-dialog.site-dialog .el-form-item__label) {
  color: #334155 !important;
  font-weight: 700 !important;
}

:global(.site-dialog .el-input__wrapper),
:global(.el-dialog.site-dialog .el-input__wrapper) {
  background: #ffffff !important;
  border: 1px solid #bfdbfe !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

:global(.site-dialog .el-input__inner),
:global(.el-dialog.site-dialog .el-input__inner) {
  color: #0f172a !important;
}

:global(.site-dialog .el-input__inner::placeholder),
:global(.el-dialog.site-dialog .el-input__inner::placeholder) {
  color: #94a3b8 !important;
}

:global(.site-dialog-cancel) {
  color: #1d4ed8 !important;
  background: #ffffff !important;
  border-color: #bfdbfe !important;
  border-radius: 8px !important;
  font-weight: 700 !important;
}

:global(.site-dialog-confirm) {
  color: #ffffff !important;
  background: #2563eb !important;
  border-color: #2563eb !important;
  border-radius: 8px !important;
  font-weight: 800 !important;
}

.ai-analysis-body {
  position: relative;
  height: 100%;
  min-height: 180px;
  overflow-y: auto;
}

.ai-analysis-result {
  min-height: 100%;
}

.ai-analysis-title {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 800;
  color: #0f172a;
}

.ai-analysis-content {
  margin: 0;
  line-height: 1.7;
  color: #334155;
  white-space: pre-wrap;
}

.ai-analysis-error {
  color: #dc2626;
}

:global(.ai-analysis-dialog .el-loading-mask) {
  background: rgba(255, 255, 255, 0.92) !important;
  border-radius: 8px !important;
}

:global(.ai-analysis-dialog .el-loading-spinner .path) {
  stroke: #2563eb !important;
}

:global(.ai-analysis-dialog .el-loading-spinner .el-loading-text) {
  color: #2563eb !important;
}

:global(.ai-analysis-dialog.el-dialog) {
  height: 80vh;
  display: flex;
  flex-direction: column;
}

:global(.ai-analysis-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.browser-panel {
  position: relative;
  z-index: 1;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: #ffffff;
}

.tab-strip {
  flex: 0 0 auto;
  display: flex;
  align-items: end;
  gap: 4px;
  min-height: 38px;
  padding: 6px 8px 0;
  border-bottom: 1px solid #dbeafe;
  background: #eef6ff;
  overflow-x: auto;
}

.browser-tab {
  min-width: 120px;
  max-width: 220px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  color: #475569;
  background: #e7f0fb;
  border: 1px solid #dbeafe;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  font-size: 12px;
  transition: 0.15s ease;
}

.browser-tab.active {
  color: #0f172a;
  background: #ffffff;
  border-color: #bfdbfe;
  font-weight: 700;
}

.tab-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-loading {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: #38bdf8;
  animation: pulse-tab-loading 1s infinite;
}

@keyframes pulse-tab-loading {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.tab-close,
.new-tab-btn,
.find-close {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 22px;
  color: #64748b;
  background: transparent;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.tab-close:hover,
.new-tab-btn:hover,
.find-close:hover {
  color: #1d4ed8;
  background: #dbeafe;
}

.new-tab-btn {
  margin-bottom: 4px;
  color: #1d4ed8;
  font-weight: 800;
}

.browser-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid #dbeafe;
  background: #f8fbff;
}

.toolbar-icon-btn,
.toolbar-star-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 34px;
  color: #64748b;
  background: #ffffff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: 0.15s ease;
}

.toolbar-icon-btn:hover {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #60a5fa;
}

.toolbar-icon-btn:focus-visible,
.toolbar-star-btn:focus-visible {
  outline: 3px solid rgba(56, 189, 248, 0.22);
  outline-offset: 1px;
}

.toolbar-star-btn:hover {
  color: #ca8a04;
  background: #fffbeb;
  border-color: #fde68a;
}

.toolbar-star-btn.active {
  color: #f59e0b;
  background: #fffbeb;
  border-color: #fbbf24;
}

.find-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #dbeafe;
  background: #ffffff;
}

.find-input {
  width: 260px;
}

.find-input :deep(.el-input__wrapper) {
  background: #ffffff !important;
  border: 1px solid #bfdbfe !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

.find-input :deep(.el-input__inner) {
  color: #0f172a !important;
}

.find-count {
  min-width: 42px;
  color: #64748b;
  font-size: 12px;
  text-align: center;
}

.find-btn {
  color: #1d4ed8 !important;
  background: #ffffff !important;
  border-color: #bfdbfe !important;
  border-radius: 8px !important;
  font-weight: 700;
}

.address-input {
  flex: 1;
  color-scheme: light;
  --el-input-bg-color: #ffffff;
  --el-input-text-color: #0f172a;
  --el-input-border-color: #bfdbfe;
  --el-input-hover-border-color: #93c5fd;
  --el-input-focus-border-color: #38bdf8;
  --el-input-placeholder-color: #94a3b8;
}

.address-input :deep(.el-input__wrapper) {
  background: #ffffff !important;
  border: 1px solid #bfdbfe !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

.address-input :deep(.el-input__wrapper:hover) {
  border-color: #93c5fd !important;
}

.address-input :deep(.el-input__wrapper.is-focus) {
  border-color: #38bdf8 !important;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14) !important;
}

.address-input :deep(.el-input__inner) {
  color: #0f172a !important;
  background: #ffffff !important;
  caret-color: #0f172a;
}

.address-input :deep(.el-input__inner::placeholder) {
  color: #94a3b8 !important;
}

.proxy-chip {
  min-width: 52px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  color: #475569;
  background: #e2e8f0;
}

.proxy-chip.proxy {
  color: #0f766e;
  background: #ccfbf1;
}

.proxy-chip.pac {
  color: #6d28d9;
  background: #ede9fe;
}

.webview-stack {
  flex: 1;
  min-height: 520px;
  position: relative;
  overflow: hidden;
}

.search-webview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  visibility: hidden;
  pointer-events: none;
}

.search-webview.active {
  visibility: visible;
  pointer-events: auto;
}

@media (max-width: 1100px) {
  .engine-grid {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 760px) {
  .engine-grid {
    grid-template-columns: 1fr;
  }

  .browser-toolbar {
    flex-wrap: wrap;
  }

  .address-input {
    min-width: 100%;
    order: 2;
  }
}
</style>
