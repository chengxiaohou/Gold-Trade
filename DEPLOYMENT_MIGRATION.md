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

### ⚠️ 重要提示：避免部署冲突

**在合并 PR 之前，必须先处理 Action-Test 分支的工作流，以避免两个分支同时部署到 GitHub Pages 造成冲突！**

当前状况：
- Action-Test 分支的工作流仍在运行
- 两个工作流会部署到同一个 GitHub Pages
- 可能会相互覆盖，导致部署混乱

---

### 步骤 0：禁用旧工作流（⚠️ 必须先执行）

**在合并 PR 到 main 分支之前，必须先执行以下任一操作：**

#### 方案 A：直接删除 Action-Test 分支（推荐）
如果不再需要 Action-Test 分支，建议直接删除：

```bash
# 删除远程 Action-Test 分支
git push origin --delete Action-Test

# 删除本地分支（如果有）
git branch -d Action-Test
```

**优点**：
- 一次性解决问题
- 清理仓库结构
- 避免后续混淆

#### 方案 B：禁用 Action-Test 分支的工作流
如果暂时需要保留分支，可以禁用其工作流：

1. 进入仓库的 **Actions** 标签页
2. 在左侧找到 "Deploy to GitHub Pages" 工作流
3. 点击右上角的 "..." 菜单
4. 选择 "Disable workflow"（禁用工作流）

或者，删除 Action-Test 分支上的工作流文件：
```bash
git checkout Action-Test
rm -rf .github/workflows/deploy.yml
git add .
git commit -m "Remove deployment workflow from Action-Test branch"
git push origin Action-Test
```

---

### 步骤 1：合并 PR
**只有在完成步骤 0 后才能执行此步骤！**

将此 PR 合并到 main 分支。

---

### 步骤 2：验证部署
1. 合并后，检查 GitHub Actions 是否自动运行
2. 在仓库的 "Actions" 标签页中查看工作流运行状态
3. 确认部署成功后，访问 GitHub Pages URL 验证网站：
   ```
   https://chengxiaohou.github.io/Gold-Trade/
   ```

---

### 步骤 3：配置 GitHub Pages 设置（如需要）
1. 进入仓库设置：Settings → Pages
2. 确认 Source 设置为 "GitHub Actions"
3. 如果不是，请选择 "GitHub Actions" 作为部署源

---

### 步骤 4：清理（如果步骤 0 选择了方案 B）
如果在步骤 0 中只是禁用了工作流而没有删除分支，现在可以删除 Action-Test 分支：

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

## 工作流对比

### 旧配置（Action-Test 分支）
- 触发分支：Action-Test
- 部署源：Action-Test 分支

### 新配置（main 分支）
- 触发分支：main
- 部署源：main 分支
- 配置完全相同，只是触发分支不同

## 注意事项

### 🔴 关键警告

1. **必须先处理 Action-Test 分支的工作流！**
   - ⚠️ 在合并 PR 前，务必先删除 Action-Test 分支或禁用其工作流
   - ⚠️ 否则两个工作流会同时部署到同一个 GitHub Pages，造成冲突
   - ⚠️ 可能导致部署失败或内容被反复覆盖

2. **正确的操作顺序**
   - 第一步：删除或禁用 Action-Test 分支的部署工作流
   - 第二步：合并 PR 到 main 分支
   - 第三步：验证 main 分支的部署成功
   - 第四步：清理（如果第一步没有删除分支）

3. **验证要求**
   - 删除 Action-Test 分支前，请确保 main 分支的部署已成功运行至少一次
   - 访问网站确认功能正常

4. **URL 不变**
   - GitHub Pages 的 URL 不会改变，仍然是：`https://chengxiaohou.github.io/Gold-Trade/`

5. **环境变量**
   - 环境变量和秘密不需要更改，工作流会自动使用仓库级别的配置

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
