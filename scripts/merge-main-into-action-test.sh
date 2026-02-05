#!/usr/bin/env bash
set -euo pipefail

# 安全脚本：把远端 main 合并到当前分支 Action-Test
# 使用前请确保已经 stash/commit 所有本地改动

TARGET_BRANCH="Action-Test"
MAIN_BRANCH="main"

# 检查工作区是否干净
if [ -n "$(git status --porcelain)" ]; then
  echo "错误：工作目录存在未提交改动，请先 commit 或 stash。"
  git status --porcelain
  exit 1
fi

echo "fetch origin..."
git fetch origin

# 确保远端 main 存在
if ! git rev-parse --verify --quiet origin/${MAIN_BRANCH} >/dev/null; then
  echo "错误：远端分支 origin/${MAIN_BRANCH} 不存在。"
  exit 1
fi

# 切换到目标分支
echo "切换到 ${TARGET_BRANCH}..."
if ! git show-ref --verify --quiet refs/heads/${TARGET_BRANCH}; then
  echo "本地没有 ${TARGET_BRANCH} 分支，尝试从远端检出..."
  git checkout -b ${TARGET_BRANCH} origin/${TARGET_BRANCH}
else
  git checkout ${TARGET_BRANCH}
  echo "拉取远端最新 ${TARGET_BRANCH}..."
  git pull --ff-only origin ${TARGET_BRANCH} || true
fi

echo "合并 origin/${MAIN_BRANCH} -> ${TARGET_BRANCH}..."
# 使用 --no-edit 自动生成合并提交信息；如果有冲突会失败并留下未合并状态
if ! git merge --no-edit origin/${MAIN_BRANCH}; then
  echo "合并失败：可能存在冲突，请手动解决冲突后运行："
  echo "  git add <file>"
  echo "  git commit"
  echo "  git push origin ${TARGET_BRANCH}"
  exit 1
fi

# 推送到远端
echo "推送 ${TARGET_BRANCH} 到 origin..."
git push origin ${TARGET_BRANCH}

echo "合并完成 ✅"