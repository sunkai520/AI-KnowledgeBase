// 系统级桌面通知（Windows 下走系统通知中心，电脑右下角弹出来），
// 跟 ElMessage/ElMessageBox 这类应用内提示的区别是：哪怕窗口被最小化到托盘、不可见，也能弹出来。
// 用 Electron 自带的 Notification，不需要额外依赖。
import { Notification, BrowserWindow } from 'electron';
//@ts-ignore
import icon from '../../../resources/icon.png?asset';

// 返回值表示是否真的尝试弹出了通知：调用方（比如 send_notification 工具）需要这个结果
// 如实告诉模型"到底有没有真的弹出来"，不能不管支不支持都回一句"已发送"
export function showDesktopNotification(title: string, body: string, onClick?: () => void): boolean {
  if (!Notification.isSupported()) return false;

  const notification = new Notification({ title, body, icon });
  notification.on('click', () => {
    if (onClick) {
      onClick();
      return;
    }
    // 默认行为：点一下通知就把主窗口显示并激活，方便直接去看详情
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
  });
  notification.show();
  return true;
}
