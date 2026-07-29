#!/bin/bash
set -e

# 默认 Electron 应用安装目录（你要根据实际修改）
APP_DIR="/opt/SkDAI"
SANDBOX_PATH="$APP_DIR/chrome-sandbox"
EXECUTABLE_PATH="$APP_DIR/SkDAI"
LINK_PATH="/usr/bin/SkDAI"


# 判断chrome-sandbox是否存在
if [ ! -f "$SANDBOX_PATH" ]; then
  echo "❌ 找不到 chrome-sandbox：$SANDBOX_PATH"
  exit 1
fi

# 检查是否已有 override 存在
if dpkg-statoverride --list "$SANDBOX_PATH" > /dev/null 2>&1; then
  echo "ℹ️ 已存在 override，准备移除"
  dpkg-statoverride --remove "$SANDBOX_PATH"
fi


# 注册 statoverride，以确保权限生效
dpkg-statoverride --update --add root root 4755 "$SANDBOX_PATH"

echo "✅ chrome-sandbox 权限和属主设置完成：$SANDBOX_PATH"

# 添加 /usr/bin/SkDAI 软链接（存在则跳过）
if [ ! -L "$LINK_PATH" ]; then
  sudo ln -s "$EXECUTABLE_PATH" "$LINK_PATH"
  echo "✅ 创建软链接：$LINK_PATH -> $EXECUTABLE_PATH"
else
  echo "ℹ️ 软链接已存在：$LINK_PATH"
fi

echo "✅ 权限和软链接设置完成"
