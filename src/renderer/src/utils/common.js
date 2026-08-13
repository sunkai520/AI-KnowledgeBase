import { ElMessage } from "element-plus";
import { userModule } from "@renderer/store/user";
// 获取当前时间
export function getCurrentTime() {
  let date = new Date();
  const year = date.getFullYear();
  const month =
    date.getMonth() >= 9 ? date.getMonth() + 1 : "0" + (date.getMonth() + 1);
  const day = date.getDate() > 9 ? date.getDate() : "0" + date.getDate();
  const hour = date.getHours() > 9 ? date.getHours() : "0" + date.getHours();
  const minute =
    date.getMinutes() > 9 ? date.getMinutes() : "0" + date.getMinutes();
  const second =
    date.getSeconds() > 9 ? date.getSeconds() : "0" + date.getSeconds();
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
export function formatDate(date, fmt = "yyyy-MM-dd hh:mm:ss") {
  if (!date) return "";
  const newDate = new Date(date);
  if (/(y+)/.test(fmt)) {
    fmt = fmt.replace(
      RegExp.$1,
      (newDate.getFullYear() + "").substr(4 - RegExp.$1.length)
    );
  }
  const o = {
    "M+": newDate.getMonth() + 1,
    "d+": newDate.getDate(),
    "h+": newDate.getHours(),
    "m+": newDate.getMinutes(),
    "s+": newDate.getSeconds(),
  };
  for (const k in o) {
    if (new RegExp(`(${k})`).test(fmt)) {
      const str = o[k] + "";
      fmt = fmt.replace(
        RegExp.$1,
        RegExp.$1.length === 1 ? str : padLeftZero(str)
      );
    }
  }

  function padLeftZero(str) {
    return ("00" + str).substr(str.length);
  }
  return fmt;
}
// 会话列表创建时间展示：不同页面的会话表字段名不统一（createTime / createdAt），这里统一兼容取值；
// 存的已经是本地时间 "yyyy-MM-dd hh:mm:ss" 字符串，直接裁剪成"MM-dd HH:mm"，不用再转 Date 对象避免时区问题
export function formatSessionTime(session) {
  const raw = session?.createTime ?? session?.createdAt;
  if (!raw) return "";
  const m = String(raw).match(/^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : String(raw);
}
//复制
export function copyText(text) {
  if (document.execCommand("copy")) {
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.innerHTML = text;
    input.select();
    document.execCommand("copy");
    ElMessage.success("内容已复制到剪贴板");
    document.body.removeChild(input);
  } else {
    ElMessage.info("浏览器版本过低，不支持复制功能，请升级到最新版本的浏览器");
  }
}
//防抖
export function debounce(fn, wait = 500) {
  let timer = null;
  return (args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    timer = setTimeout(() => {
      fn && fn(args);
    }, wait);
  };
}
//深拷贝
export function deepClone(target) {
  let result;
  if (typeof target === "object") {
    // 如果当前需要深拷贝的是一个对象
    if (Array.isArray(target)) {
      // 如果是一个数组
      result = []; // 将result赋值为一个数组，并且执行遍历
      for (let i in target) {
        result.push(deepClone(target[i])); // 递归克隆数组中的每一项
      }
    } else if (target === null) {
      result = null; // 判断如果当前的值是null，直接赋值为null
    } else if (target.constructor === RegExp) {
      result = target; // 判断如果当前的值是一个RegExp对象，直接赋值
    } else {
      result = {}; // 否则是普通对象，直接for in循环，递归赋值对象的所有值
      for (let i in target) {
        result[i] = deepClone(target[i]);
      }
    }
  } else {
    result = target; // 如果不是对象，就是基本数据类型，直接赋值
  }
  return result; // 返回最终结果
}

/**
 * 语音播报
 */
export function speechText(str) {
  const user = userModule();
  if (!user.isSound) {
    return;
  }
  window.electronAPI.speekText(str);
  // console.log(str)
  // if ("speechSynthesis" in window) {
  //   window.speechSynthesis.cancel();
  //   const utterance = new SpeechSynthesisUtterance(str);
  //   window.speechSynthesis.speak(utterance);
  // } else {
  //   ElMessage.error("您的浏览器暂时不支持语音播报。");
  // }
  //通用入口
  if (typeof window !== "undefined" && window.speechSynthesis) {
    // 浏览器
    const utterance = new SpeechSynthesisUtterance(str);
    window.speechSynthesis.speak(utterance);
  } else {
    window.electronAPI.speekText(str);
  }
}

export function calculateDistance2D(x1, y1, x2, y2) {
  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  return distance;
}
