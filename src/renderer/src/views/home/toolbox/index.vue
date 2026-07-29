<template>
  <div class="page-wrap">
    <div class="setting-layout">
      <!-- 左侧菜单 -->
      <aside class="sidebar">
        <div class="sidebar-title">工具箱</div>
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

        <ScheduledTask v-if="activeMenu === 'scheduledTask'" />
        <FolderOrganizer v-else-if="activeMenu === 'folderOrganizer'" />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import ScheduledTask from "./scheduledTask/index.vue";
import FolderOrganizer from "./folderOrganizer/index.vue";

const menuItems = [
  { key: "scheduledTask", icon: "⏰", label: "定时任务", desc: "设置一个自然语言指令，按间隔或每天固定时间自动执行" },
  { key: "folderOrganizer", icon: "🗂️", label: "文件夹整理", desc: "选中一个文件夹，按类型自动分类整理里面的文件" },
];

const activeMenu = ref("scheduledTask");
const currentMenu = computed(() => menuItems.find((m) => m.key === activeMenu.value) || menuItems[0]);
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

  .menu-icon {
    font-size: 16px;
  }

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

.content-header {
  margin-bottom: 16px;
}
.content-title {
  font-size: 17px;
  font-weight: 700;
  color: #f1f5f9;
  margin: 0 0 4px;
}
.content-desc {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}
.content-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin-bottom: 24px;
}
</style>
