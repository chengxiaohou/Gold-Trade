# GitHub Pages 部署迁移指南

## 概述
本文档说明如何从 Action-Test 分支迁移到 main 分支进行 GitHub Pages 自动部署。

## 当前状态
- ✅ main 分支已配置 GitHub Actions 工作流（`.github/workflows/deploy.yml`）
- ✅ vite.config.ts 已更新以支持 GitHub Pages 部署
- ⏳ Action-Test 分支仍然存在（待删除）

## 已完成的更改

### 1. 创建 GitHub Actions 工作流
在 main 分支上创建了 `.github/workflows/deploy.yml` 文件：
- 触发条件：push 到 main 分支
- 支持手动触发（workflow_dispatch）
- 自动构建并部署到 GitHub Pages

### 2. 更新 Vite 配置
修改了 `vite.config.ts`：
- 添加了 `base` 配置，支持通过 `VITE_BASE` 环境变量设置基础路径
- 确保项目可以正确部署到 GitHub Pages 的子路径（如 `/Gold-Trade/`）

## 后续步骤

### 步骤 1：验证部署
1. 将此 PR 合并到 main 分支
2. 检查 GitHub Actions 是否自动运行
3. 在仓库的 "Actions" 标签页中查看工作流运行状态
4. 确认部署成功后，访问 GitHub Pages URL 验证网站

### 步骤 2：配置 GitHub Pages 设置（如需要）
1. 进入仓库设置：Settings → Pages
2. 确认 Source 设置为 "GitHub Actions"
3. 如果不是，请选择 "GitHub Actions" 作为部署源

### 步骤 3：删除 Action-Test 分支
一旦确认 main 分支的部署工作正常：

**通过 GitHub 网页界面：**
1. 进入仓库的 "Branches" 页面
2. 找到 Action-Test 分支
3. 点击删除按钮

**通过命令行：**
```bash
# 删除远程分支
git push origin --delete Action-Test

# 删除本地分支（如果有）
git branch -d Action-Test
```

### 步骤 4：清理（可选）
- Action-Test 分支上的旧工作流会在删除分支后自动失效
- 无需额外操作

## 工作流对比

### 旧配置（Action-Test 分支）
- 触发分支：Action-Test
- 部署源：Action-Test 分支

### 新配置（main 分支）
- 触发分支：main
- 部署源：main 分支
- 配置完全相同，只是触发分支不同

## 注意事项
1. 删除 Action-Test 分支前，请确保 main 分支的部署已成功运行至少一次
2. GitHub Pages 的 URL 不会改变，仍然是：`https://chengxiaohou.github.io/Gold-Trade/`
3. 环境变量和秘密不需要更改，工作流会自动使用仓库级别的配置

## 技术细节

### 工作流权限
```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```
这些权限允许工作流读取代码、写入 Pages 部署、使用 OIDC 令牌进行身份验证。

### 构建配置
- Node.js 版本：18
- 包管理器：npm
- 构建命令：`npm run build`
- 输出目录：`./dist`

### 环境变量
- `VITE_BASE`：自动设置为 `/<仓库名>/`（例如：`/Gold-Trade/`）

## 故障排除

### 如果部署失败
1. 检查 Actions 日志中的错误信息
2. 确认 package.json 中存在 `build` 脚本
3. 确认所有依赖项都在 package.json 中正确声明
4. 检查 GitHub Pages 是否在仓库设置中启用

### 如果页面显示 404
1. 确认 vite.config.ts 中的 base 配置正确
2. 检查 GitHub Pages URL 是否正确
3. 等待几分钟，GitHub Pages 部署可能需要一些时间

## 支持
如有问题，请查看：
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [GitHub Pages 文档](https://docs.github.com/en/pages)
- [Vite 部署文档](https://vitejs.dev/guide/static-deploy.html)
