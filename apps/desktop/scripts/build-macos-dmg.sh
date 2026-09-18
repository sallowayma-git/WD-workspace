#!/usr/bin/env bash
#
# 组装 macOS 发布用的 DMG。
#
# 为什么不用 `tauri build --bundles dmg`：
# Tauri 自带的 DMG 只会放 <产品名>.app 和一个 /Applications 快捷方式。配置项
# bundle.macOS.files 的路径是相对 <产品名>.app/Contents 解析的，只能往 app 包
# 内部塞文件，塞不进 DMG 根目录。而我们需要在 DMG 根目录放「首次打开说明.txt」
# 和「修复并打开.command」（没有 Apple 开发者账号，用户必须自己摘掉隔离标记）。
# 所以这里让 Tauri 只产 .app，再由本脚本用 hdiutil 组装 DMG。
#
# 用法：
#   bash apps/desktop/scripts/build-macos-dmg.sh
#
# 仅限 macOS。产物：
#   apps/desktop/src-tauri/target/release/bundle/dmg/<产品名>_<版本>_<架构>.dmg
# 文件名带版本号，是为了和 Tauri 自带的命名保持一致（NSIS 出的是
# 助教工作台_0.1.0_x64-setup.exe）。DMG 是我们自己组装的，如果只叫
# 助教工作台.dmg，用户把两个版本的安装包下载到同一个目录就会互相覆盖。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAURI_DIR="${DESKTOP_DIR}/src-tauri"
CONF_PATH="${TAURI_DIR}/tauri.conf.json"
EXTRA_DIR="${TAURI_DIR}/macos"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "错误：本脚本只能在 macOS 上运行（当前系统：$(uname -s)）。" >&2
  exit 1
fi

PRODUCT_NAME="$(node -e "process.stdout.write(require(process.argv[1]).productName)" "${CONF_PATH}")"
if [ -z "${PRODUCT_NAME}" ]; then
  echo "错误：没能从 ${CONF_PATH} 读到 productName。" >&2
  exit 1
fi

VERSION="$(node -e "process.stdout.write(require(process.argv[1]).version)" "${CONF_PATH}")"
if [ -z "${VERSION}" ]; then
  echo "错误：没能从 ${CONF_PATH} 读到 version。" >&2
  exit 1
fi

# 和 Tauri 的 bundle 命名对齐：arm64 在 bundle 名里写作 aarch64。
case "$(uname -m)" in
  arm64) BUNDLE_ARCH="aarch64" ;;
  x86_64) BUNDLE_ARCH="x86_64" ;;
  *)
    echo "错误：未知的 CPU 架构 $(uname -m)。" >&2
    exit 1
    ;;
esac

APP_NAME="${PRODUCT_NAME}.app"
APP_PATH="${TAURI_DIR}/target/release/bundle/macos/${APP_NAME}"
DMG_DIR="${TAURI_DIR}/target/release/bundle/dmg"
DMG_PATH="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg"

INSTRUCTIONS="${EXTRA_DIR}/首次打开说明.txt"
HELPER="${EXTRA_DIR}/修复并打开.command"

for required in "${INSTRUCTIONS}" "${HELPER}"; do
  if [ ! -f "${required}" ]; then
    echo "错误：缺少随包文件 ${required}" >&2
    exit 1
  fi
done

STAGING=""
MOUNT_POINT=""
cleanup() {
  if [ -n "${MOUNT_POINT}" ]; then
    hdiutil detach "${MOUNT_POINT}" -quiet >/dev/null 2>&1 || true
    rm -rf "${MOUNT_POINT}"
  fi
  if [ -n "${STAGING}" ]; then
    rm -rf "${STAGING}"
  fi
  return 0
}
trap cleanup EXIT

# 等待某个 .app 出现有效的 ad-hoc 签名，最多重试 10 次（每次间隔 1 秒）。
#
# 判定分两步：`codesign --verify` 的退出码说明签名结构有效、内容未被篡改；
# `codesign -d` 的输出再确认签名类型是 ad-hoc，而不是开发者证书。
#
# 为什么要重试：刚被 codesign 写入签名（Tauri 打完包）或压缩镜像刚挂载时，
# 第一次读取会偶发失败。只调一次会把「已经签好了」误判成「没签名」，让 CI 假失败。
# 重试不影响安全性：真的没签名会 10 次全失败，脚本照样报错退出。
wait_for_adhoc_signature() {
  local app="$1"
  local attempt
  local detail=""
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    detail="$(codesign -d --verbose=4 "${app}" 2>&1)" || detail=""
    # 不要写成 `codesign ... | grep -q adhoc`：本脚本开了 set -o pipefail，
    # grep -q 命中后立即退出会让 codesign 收到 SIGPIPE（退出码 141），整条管道
    # 因此被判为失败，已经签好的包会被误判成「未签名」。改成先取回输出再匹配。
    if codesign --verify "${app}" >/dev/null 2>&1 && [[ "${detail}" == *adhoc* ]]; then
      if [ "${attempt}" -gt 1 ]; then
        echo "  （第 ${attempt} 次尝试才读到签名，已重试通过）"
      fi
      return 0
    fi
    sleep 1
  done
  echo "  最后一次读取签名的输出：" >&2
  printf '%s\n' "${detail}" | sed 's/^/    /' >&2
  return 1
}

# 注意：变量名后面紧跟中文标点时必须写成 ${VAR}。在部分 locale 下 bash 会把
# 多字节字符的首字节吞进变量名，`$APP_NAME（` 会被解析成未定义的 `APP_NAME<byte>`，
# 在 set -u 下直接报 unbound variable。
echo "==> 1/5 构建 ${APP_NAME}（--bundles app）"
# --bundles app 覆盖配置里的 bundle.targets，只产出 .app，DMG 由本脚本负责。
pnpm --dir "${DESKTOP_DIR}" tauri build --bundles app

if [ ! -d "${APP_PATH}" ]; then
  echo "错误：没有找到构建产物 ${APP_PATH}" >&2
  exit 1
fi

echo
echo "==> 2/5 校验代码签名"
# 没有 Apple 开发者账号，但 Apple Silicon 上「完全未签名」的二进制会被内核直接
# 拒绝执行（用户看到的就是「已损坏」）。所以必须确认 Tauri 按
# tauri.macos.conf.json 里的 bundle.macOS.signingIdentity = "-" 做了 ad-hoc 签名。
if ! wait_for_adhoc_signature "${APP_PATH}"; then
  echo "错误：${APP_NAME} 不是 ad-hoc 签名。" >&2
  echo "      请确认 ${TAURI_DIR}/tauri.macos.conf.json 中" >&2
  echo "      bundle.macOS.signingIdentity 的值为 \"-\"。" >&2
  exit 1
fi
codesign --verify --verbose=2 "${APP_PATH}"
echo "签名校验通过（ad-hoc）。"

echo
echo "==> 3/5 组装 DMG 内容"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/assistant-dmg-staging.XXXXXX")"
# ditto 而不是 cp -R：ditto 会保留符号链接、权限和扩展属性。
ditto "${APP_PATH}" "${STAGING}/${APP_NAME}"
cp "${INSTRUCTIONS}" "${STAGING}/首次打开说明.txt"
cp "${HELPER}" "${STAGING}/修复并打开.command"
chmod +x "${STAGING}/修复并打开.command"
# 拖拽安装用的快捷方式。
ln -s /Applications "${STAGING}/Applications"
ls -la "${STAGING}"

echo
echo "==> 4/5 生成 DMG"
mkdir -p "${DMG_DIR}"
# -ov 表示覆盖已存在的同名镜像，所以不需要先 rm。
# -fs HFS+：比 APFS 容器兼容性更好，老系统也能挂载。
hdiutil create \
  -volname "${PRODUCT_NAME}" \
  -srcfolder "${STAGING}" \
  -fs HFS+ \
  -format UDZO \
  -ov \
  "${DMG_PATH}"
hdiutil verify "${DMG_PATH}"

echo
echo "==> 5/5 回读校验 DMG 内容"
MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/assistant-dmg-mount.XXXXXX")"
hdiutil attach "${DMG_PATH}" -nobrowse -readonly -mountpoint "${MOUNT_POINT}" >/dev/null

missing=0
for entry in "${APP_NAME}" "首次打开说明.txt" "修复并打开.command" "Applications"; do
  if [ -e "${MOUNT_POINT}/${entry}" ]; then
    echo "  [ok] ${entry}"
  else
    echo "  [缺失] ${entry}" >&2
    missing=1
  fi
done

if [ "${missing}" -ne 0 ]; then
  echo "错误：DMG 内容不完整。" >&2
  exit 1
fi

# 挂载出来的 app 也必须是 ad-hoc 签名，避免「装完才发现打不开」。
if ! wait_for_adhoc_signature "${MOUNT_POINT}/${APP_NAME}"; then
  echo "错误：DMG 内的 ${APP_NAME} 不是 ad-hoc 签名。" >&2
  exit 1
fi
echo "  [ok] ${APP_NAME} 为 ad-hoc 签名"

hdiutil detach "${MOUNT_POINT}" -quiet
rm -rf "${MOUNT_POINT}"
MOUNT_POINT=""

echo
echo "完成：${DMG_PATH}"
echo "体积：$(du -h "${DMG_PATH}" | cut -f1)"
