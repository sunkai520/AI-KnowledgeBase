import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";
import { userModule } from "@renderer/store/user";
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
// 配置进度条样式
NProgress.configure({
  showSpinner: false,      // 不显示旋转圆圈
  easing: 'ease',          // 动画效果
  speed: 500,              // 速度
  trickleSpeed: 200,       // 自动递增速度
  minimum: 0.1             // 最小百分比
})
const routes: Array<RouteRecordRaw> = [
  {
    path: "/index",
    name: "index",
    component: () => import("../views/index.vue"),
  },
  {
    path: "/home",
    name: "home",
    component: () => import("../views/home/index.vue"),
    children: [
      {
        path: "chat",
        name: "chat",
        component: () => import("../views/home/chat/index.vue"),
      },
     
      {
        path: "ragDocs",
        name: "ragDocs",
        component: () => import("../views/home/rag/index.vue"),
      },
      {
        path: "writeText",
        name: "writeText",
        component: () => import("../views/home/rag/writeText.vue"),
      },
      {
        path: "seeText",
        name: "seeText",
        component: () => import("../views/home/rag/seeText.vue"),
      },
      {
        path: "mediaManage",
        name: "mediaManage",
        component: () => import("../views/home/mediaManage/index.vue"),
      },
      {
        path: "writeStyle",
        name: "writeStyle",
        component: () => import("../views/home/writeStyle/profileIndexV2.vue"),
      },
      {
        path: "writeStyle/editor",
        name: "writeStyleEditor",
        component: () => import("../views/home/writeStyle/profileEditor.vue"),
      },
      {
        path: "modelSetting",
        name: "modelSetting",
        component: () => import("../views/home/modelSetting/index.vue"),
      },
      {
        path: "agent",
        name: "agent",
        component: () => import("../views/home/agent/index.vue"),
      },
      {
        path: "onlineSearch",
        name: "onlineSearch",
        component: () => import("../views/home/onlineSearch/index.vue"),
      },
      {
        path: "systemSetting",
        name: "systemSetting",
        component: () => import("../views/home/systemSetting/index.vue"),
      },
      {
        path: "toolbox",
        name: "toolbox",
        component: () => import("../views/home/toolbox/index.vue"),
      }
    ]
  },

  {
    path: "/404",
    name: "404",
    component: () => import("../views/404/index.vue"),
  },
  {
    path: "/login",
    name: "login",
    component: () => import("../views/login/index.vue"),
  },
  {
    path: "/setup",
    name: "setup",
    component: () => import("../views/setup/index.vue"),
  },
  {
    path: "/",
    redirect: "/index",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes: routes,
});
const whiteList: string[] = ['/404', '/setup']
// @ts-ignore
router.beforeEach(async (to, from, next) => {
  NProgress.start()

  // 优先检查数据目录是否已配置
  if (!whiteList.includes(to.path)) {
    const status = await (window as any).electronAPI.getDataPathStatus();
    if (!status.isConfigured) {
      next('/setup');
      return;
    }
  }

  const user = userModule();
  if (user.is_activation) {
    if (to.path === '/404') {
      next('/')
    } else {
      next()
    }
  } else {
    if (whiteList.indexOf(to.path) !== -1) {
      next();
    } else {
      const res = await user.sendActivate();
      if (res) {
        next("/index");
      } else {
        next('/404');
      }
    }
  }
});
router.afterEach(() => {
  NProgress.done()   // 结束进度条
})

router.onError(() => {
  NProgress.done()   // 错误时也要结束
})
export default router;
