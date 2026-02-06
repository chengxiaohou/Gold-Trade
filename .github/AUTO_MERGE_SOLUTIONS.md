# 自动合并 main 分支到 action-test 分支的实现方案

本文档讨论了多种实现方案，用于在代码推送到 main 分支时自动合并到 action-test 分支。

## 方案总览

### 方案 1: GitHub Actions + Git 命令（✅ 已实现）

**优点:**
- 简单直接，易于理解和维护
- 使用标准的 Git 命令
- 不需要额外的配置或权限
- 可以处理合并冲突（需要额外配置）

**缺点:**
- 需要创建 workflow 文件
- 在合并冲突时需要手动处理

**实现位置:** `.github/workflows/auto-merge-to-action-test.yml`

**工作流程:**
1. 监听 main 分支的 push 事件
2. 检查 action-test 分支是否存在
3. 如果不存在则创建，如果存在则检出
4. 将 main 分支合并到 action-test 分支
5. 推送更改

### 方案 2: GitHub Actions + GitHub CLI

**优点:**
- 使用 GitHub 官方工具
- 可以利用更多 GitHub 特性（如 PR、Issues）
- 更符合 GitHub 的工作流程

**缺点:**
- 需要额外安装 gh CLI
- 稍微复杂一些

**示例代码:**
```yaml
name: Auto-merge using gh CLI

on:
  push:
    branches:
      - main

jobs:
  merge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Merge using gh
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh api repos/${{ github.repository }}/merges \
            -f base=action-test \
            -f head=main \
            -f commit_message="Auto-merge main to action-test"
```

### 方案 3: GitHub Actions + GitHub REST API

**优点:**
- 完全控制合并过程
- 可以实现复杂的逻辑
- 可以与其他 API 集成

**缺点:**
- 实现较复杂
- 需要处理 API 认证和错误
- 维护成本较高

**示例代码:**
```yaml
name: Auto-merge using API

on:
  push:
    branches:
      - main

jobs:
  merge:
    runs-on: ubuntu-latest
    steps:
      - name: Merge via API
        run: |
          curl -X POST \
            -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            -H "Accept: application/vnd.github.v3+json" \
            https://api.github.com/repos/${{ github.repository }}/merges \
            -d '{"base":"action-test","head":"main","commit_message":"Auto-merge"}'
```

### 方案 4: 分支保护规则 + Auto-merge

**优点:**
- 使用 GitHub 内置功能
- 更安全，可以要求审查
- 适合需要人工审核的场景

**缺点:**
- 需要手动创建 PR
- 不是完全自动化
- 需要配置分支保护规则

**实现步骤:**
1. 设置 action-test 为受保护分支
2. 配置自动合并规则
3. 创建一个 workflow 自动创建 PR

### 方案 5: Git Hooks（服务器端）

**优点:**
- 在 Git 层面实现，不依赖 GitHub Actions
- 实时响应，延迟最低

**缺点:**
- 需要服务器端配置权限
- GitHub.com 不支持自定义服务器端 hooks
- 仅适用于自托管的 Git 服务器

## 推荐方案

对于本项目，**方案 1（GitHub Actions + Git 命令）** 是最佳选择，因为：

1. ✅ 简单易懂，容易维护
2. ✅ 不需要额外的依赖或权限
3. ✅ 可以处理大多数常见场景
4. ✅ 社区广泛使用，有大量参考资料
5. ✅ 可以轻松扩展以处理合并冲突

## 使用说明

当前实现的 workflow 会在以下情况触发：
- 代码推送到 main 分支时

workflow 会自动：
1. 检出仓库代码
2. 配置 Git 用户信息
3. 检查并切换到 action-test 分支
4. 将 main 分支的更改合并到 action-test 分支
5. 推送更新到 action-test 分支

## 处理合并冲突

如果需要处理合并冲突，可以修改 workflow 添加以下逻辑：

```yaml
- name: Merge with conflict handling
  run: |
    if ! git merge origin/main -m "Auto-merge main to action-test"; then
      echo "Merge conflict detected"
      # 可以选择：
      # 1. 创建一个 issue
      # 2. 发送通知
      # 3. 使用策略解决冲突（如 -X theirs）
      exit 1
    fi
```

## 监控和维护

- 在 GitHub Actions 标签页可以查看 workflow 运行历史
- 如果合并失败，会在 Actions 中显示错误信息
- 可以设置通知以便在失败时接收警报
