#!/bin/bash
# 修复并打开「助教工作台」
#
# 背景：macOS 会给从网上下载的文件打一个「隔离标记」(com.apple.quarantine)。
# 本应用没有 Apple 开发者签名，带着这个标记就会被系统报成「已损坏，无法打开」。
#
# 本脚本做三件事：
#   1. 把应用复制到「应用程序」文件夹（如果还没在那里）
#   2. 移除隔离标记
#   3. 打开应用
#
# 只需要运行一次，之后就正常双击即可。

APP_NAME="助教工作台.app"
DEST="/Applications/$APP_NAME"

cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo " 助教工作台 · 修复并打开"
echo "=============================================="
echo

# ---- 1. 找到应用：优先「应用程序」，其次脚本旁边 ----
SRC=""
if [ -d "$DEST" ]; then
  echo "已在「应用程序」里找到：$DEST"
elif [ -d "./$APP_NAME" ]; then
  SRC="./$APP_NAME"
else
  for candidate in ./*.app; do
    if [ -d "$candidate" ]; then
      SRC="$candidate"
      break
    fi
  done
fi

if [ -z "$SRC" ] && [ ! -d "$DEST" ]; then
  echo "没有找到「${APP_NAME}」。"
  echo
  echo "请先把应用拖进「应用程序」文件夹，然后重新运行本脚本。"
  echo
  read -r -p "按回车键关闭本窗口…" _
  exit 1
fi

# ---- 2. 需要时复制到「应用程序」 ----
if [ -n "$SRC" ]; then
  echo "正在复制到「应用程序」…"
  if ! ditto "$SRC" "$DEST" 2>/dev/null; then
    echo "普通权限复制失败，改用管理员权限（会要求输入开机密码）…"
    if ! sudo ditto "$SRC" "$DEST"; then
      echo
      echo "复制失败。请手动把「${APP_NAME}」拖进「应用程序」文件夹，再运行本脚本。"
      echo
      read -r -p "按回车键关闭本窗口…" _
      exit 1
    fi
  fi
  echo "复制完成。"
fi

# ---- 3. 移除隔离标记 ----
echo "正在移除隔离标记…"
if ! xattr -dr com.apple.quarantine "$DEST" 2>/dev/null; then
  echo "普通权限失败，改用管理员权限（会要求输入开机密码）…"
  sudo xattr -dr com.apple.quarantine "$DEST"
fi
echo "已处理完成。"

# ---- 4. 打开应用 ----
echo "正在打开…"
open "$DEST"

echo
echo "如果应用已经打开，就说明修复成功了。"
echo "以后可以直接双击打开，不需要再运行本脚本。"
echo
read -r -p "按回车键关闭本窗口…" _
