# 从零开始部署到 GitHub Pages 完整指南

## 📚 目录

1. [前言](#前言)
2. [前置条件](#前置条件)
3. [第一步：清理现有环境](#第一步清理现有环境)
4. [第二步：准备项目代码](#第二步准备项目代码)
5. [第三步：配置构建设置](#第三步配置构建设置)
6. [第四步：创建 GitHub Actions 工作流](#第四步创建-github-actions-工作流)
7. [第五步：配置 GitHub Pages](#第五步配置-github-pages)
8. [第六步：触发部署](#第六步触发部署)
9. [第七步：验证部署](#第七步验证部署)
10. [故障排除](#故障排除)
11. [进阶配置](#进阶配置)

---

## 前言

本指南将带您从零开始，一步一步地将 React + Vite 项目部署到 GitHub Pages。

### 您将学到：
- ✅ 如何清理现有的部署环境
- ✅ 如何配置 Vite 项目以支持 GitHub Pages
- ✅ 如何创建 GitHub Actions 工作流
- ✅ 如何配置和启用 GitHub Pages
- ✅ 如何验证和调试部署

### 部署方式说明

GitHub Pages 有两种主要的部署方式：

1. **传统方式**：部署特定分支（如 gh-pages 分支）
2. **GitHub Actions 方式**（推荐）：使用 GitHub Actions 自动构建和部署

本指南使用 **GitHub Actions 方式**，因为：
- ✅ 更灵活，可以自定义构建过程
- ✅ 支持任意分支触发
- ✅ 构建环境完全可控
- ✅ 更容易调试和维护

---

## 前置条件

在开始之前，请确保您有：

### 1. 账号和权限
- ✅ GitHub 账号
- ✅ 对仓库有管理员权限

### 2. 项目要求
- ✅ 项目已经可以在本地正常运行
- ✅ 项目使用 npm 或 yarn 作为包管理器
- ✅ 项目有 `package.json` 文件
- ✅ 项目有构建脚本（如 `npm run build`）

### 3. 本地环境（可选）
- ✅ Node.js 已安装（用于本地测试）
- ✅ Git 已安装

### 验证项目可以构建

在开始部署前，先在本地验证项目可以成功构建：

```bash
# 安装依赖
npm install

# 构建项目
npm run build

# 检查是否生成了 dist 目录
ls dist/
```

如果构建成功，您会看到 `dist/` 目录包含构建后的文件。

---

## 第一步：清理现有环境

如果您的仓库之前有部署过 GitHub Pages，需要先清理。

### 1.1 检查并清理 Environments

1. 进入您的 GitHub 仓库页面
2. 点击 **Settings** 标签页
3. 在左侧菜单找到 **Environments**
4. 您可能会看到以下环境：
   - `github-pages`
   - `copilot`
   - 其他环境

**决定是否删除：**

- **github-pages 环境**：
  - 如果要从零开始，可以删除
  - GitHub Pages 重新部署时会自动创建

- **copilot 环境**：
  - 与 GitHub Pages 无关
  - 可以保留或删除

**如何删除环境：**
1. 点击环境名称
2. 下拉到页面底部
3. 点击 "Delete environment" 按钮
4. 确认删除

### 1.2 禁用现有的 GitHub Pages

1. 进入 **Settings** → **Pages**
2. 如果 GitHub Pages 已启用，您会看到当前的配置
3. 暂时不需要改动，等待后续步骤

### 1.3 删除旧的工作流文件

检查项目中是否有 `.github/workflows/` 目录：

```bash
ls .github/workflows/
```

如果有旧的部署工作流文件（如 `deploy.yml`），可以删除或重命名：

```bash
# 删除
rm .github/workflows/deploy.yml

# 或者重命名为备份
mv .github/workflows/deploy.yml .github/workflows/deploy.yml.backup
```

### 1.4 删除不需要的分支

如果有专门用于部署的分支（如 `gh-pages`, `Action-Test`），可以删除：

**通过 GitHub 网页：**
1. 进入仓库主页
2. 点击分支下拉菜单
3. 点击 "View all branches"
4. 找到要删除的分支，点击删除图标

**通过命令行：**
```bash
# 删除本地分支
git branch -D gh-pages

# 删除远程分支
git push origin --delete gh-pages
```

---

## 第二步：准备项目代码

### 2.1 了解项目结构

典型的 React + Vite 项目结构：

```
your-project/
├── .github/
│   └── workflows/          # GitHub Actions 工作流（将要创建）
├── src/                    # 源代码
├── public/                 # 静态资源
├── dist/                   # 构建输出（.gitignore）
├── node_modules/           # 依赖包（.gitignore）
├── index.html              # HTML 模板
├── package.json            # 项目配置
├── vite.config.ts          # Vite 配置
└── tsconfig.json          # TypeScript 配置
```

### 2.2 检查 package.json

确保 `package.json` 中有构建脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### 2.3 检查 .gitignore

确保 `.gitignore` 包含以下内容：

```
node_modules/
dist/
.env
.env.local
```

这很重要，因为我们不想将构建产物提交到 Git 仓库。

---

## 第三步：配置构建设置

### 3.1 理解 base 路径

GitHub Pages 的 URL 格式通常是：

```
https://username.github.io/repository-name/
```

注意最后的 `/repository-name/`，这就是**子路径**。

为了让您的应用在这个子路径下正常工作，需要配置 Vite 的 `base` 选项。

### 3.2 修改 vite.config.ts

打开 `vite.config.ts`，添加 `base` 配置：

```typescript
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // 重要：配置 base 路径以支持 GitHub Pages
      // 本地开发时使用 '/'，部署时通过环境变量设置
      base: env.VITE_BASE || '/',
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
```

**说明：**
- `env.VITE_BASE`：从环境变量读取 base 路径
- `|| '/'`：如果没有设置环境变量，默认使用根路径（本地开发）
- 部署时，GitHub Actions 会设置 `VITE_BASE` 为 `/repository-name/`

### 3.3 测试本地构建

确保修改后项目仍能正常构建：

```bash
npm run build
```

---

## 第四步：创建 GitHub Actions 工作流

### 4.1 创建工作流目录

```bash
mkdir -p .github/workflows
```

### 4.2 创建工作流文件

创建文件 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

# 触发条件
on:
  # 当推送到 main 分支时触发
  push:
    branches:
      - main
  
  # 允许手动触发
  workflow_dispatch:

# 设置权限
permissions:
  contents: read      # 读取仓库内容
  pages: write        # 写入 GitHub Pages
  id-token: write     # 用于 OIDC 身份验证

# 作业定义
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
      # 第一步：检出代码
      - name: Checkout
        uses: actions/checkout@v4
      
      # 第二步：设置 Node.js 环境
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      # 第三步：安装依赖
      - name: Install dependencies
        run: npm ci
      
      # 第四步：构建项目
      - name: Build
        env:
          # 设置 base 路径为仓库名
          VITE_BASE: '/${{ github.event.repository.name }}/'
        run: npm run build
      
      # 第五步：配置 GitHub Pages
      - name: Setup Pages
        uses: actions/configure-pages@v4
      
      # 第六步：上传构建产物
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      
      # 第七步：部署到 GitHub Pages
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 4.3 理解工作流配置

**触发条件（on）：**
- `push: branches: - main`：推送到 main 分支时自动触发
- `workflow_dispatch`：允许在 GitHub 网页手动触发

**权限（permissions）：**
- `contents: read`：读取仓库代码
- `pages: write`：写入 GitHub Pages
- `id-token: write`：OIDC 身份验证（GitHub Pages 要求）

**关键步骤：**
1. **Checkout**：检出代码到工作环境
2. **Setup Node.js**：安装 Node.js 18 并缓存 npm
3. **Install dependencies**：使用 `npm ci` 安装依赖
4. **Build**：构建项目，设置 `VITE_BASE` 环境变量
5. **Setup Pages**：配置 GitHub Pages
6. **Upload artifact**：上传 `dist/` 目录
7. **Deploy**：部署到 GitHub Pages

---

## 第五步：配置 GitHub Pages

### 5.1 提交并推送工作流文件

```bash
# 添加文件
git add .github/workflows/deploy.yml
git add vite.config.ts

# 提交
git commit -m "Add GitHub Actions workflow for GitHub Pages deployment"

# 推送到 main 分支
git push origin main
```

### 5.2 配置 GitHub Pages 设置

1. 进入您的 GitHub 仓库页面
2. 点击 **Settings** 标签页
3. 在左侧菜单找到 **Pages**
4. 在 **Source** 部分：
   - 选择 **GitHub Actions**（不是 Deploy from a branch）
5. 保存设置

**重要提示：**
- 必须选择 **GitHub Actions** 作为部署源
- 这样 GitHub 才会使用我们创建的工作流进行部署

---

## 第六步：触发部署

### 方法一：自动触发（推荐）

推送代码到 main 分支会自动触发部署：

```bash
# 对代码做任何修改
git add .
git commit -m "Update code"
git push origin main
```

### 方法二：手动触发

1. 进入您的 GitHub 仓库页面
2. 点击 **Actions** 标签页
3. 在左侧找到 "Deploy to GitHub Pages" 工作流
4. 点击右侧的 "Run workflow" 按钮
5. 选择分支（通常是 main）
6. 点击绿色的 "Run workflow" 按钮

---

## 第七步：验证部署

### 7.1 查看工作流运行状态

1. 进入 **Actions** 标签页
2. 您会看到最新的工作流运行
3. 点击工作流运行查看详细日志

**状态说明：**
- 🟡 黄色（进行中）：正在运行
- 🟢 绿色（成功）：部署成功
- 🔴 红色（失败）：部署失败，点击查看错误日志

### 7.2 查看部署结果

1. 进入 **Settings** → **Pages**
2. 您会看到 "Your site is live at" 信息
3. URL 格式：`https://username.github.io/repository-name/`
4. 点击 URL 访问您的网站

**首次部署可能需要几分钟才能访问。**

### 7.3 检查部署历史

1. 在仓库页面右侧找到 **Deployments**
2. 点击查看所有部署历史
3. 每次部署都会有记录

---

## 故障排除

### 问题 1：工作流失败

**症状：** Actions 标签页显示红色 ❌

**解决方法：**
1. 点击失败的工作流运行
2. 查看哪一步失败了
3. 展开失败的步骤，查看错误信息

**常见错误：**

#### 错误：`npm ci` 失败
```
Error: Cannot find module 'xxx'
```
**原因：** `package-lock.json` 不存在或不匹配
**解决：** 
```bash
rm -rf node_modules package-lock.json
npm install
git add package-lock.json
git commit -m "Update package-lock.json"
git push
```

#### 错误：构建失败
```
Error: Build failed
```
**原因：** 代码有编译错误
**解决：** 在本地运行 `npm run build`，修复所有错误

#### 错误：权限不足
```
Error: Permission denied
```
**原因：** 工作流没有足够的权限
**解决：** 检查 `permissions` 配置是否正确

### 问题 2：网站显示 404

**症状：** 访问 GitHub Pages URL 显示 404 Not Found

**可能原因和解决方法：**

#### 原因 1：部署源配置错误
1. 进入 **Settings** → **Pages**
2. 确认 **Source** 设置为 **GitHub Actions**
3. 不要选择 "Deploy from a branch"

#### 原因 2：base 路径配置错误
检查 `vite.config.ts` 中的 `base` 配置：
```typescript
base: env.VITE_BASE || '/',
```

检查工作流中的环境变量：
```yaml
env:
  VITE_BASE: '/${{ github.event.repository.name }}/'
```

#### 原因 3：dist 目录为空
1. 查看 Actions 日志中的 "Build" 步骤
2. 确认构建成功
3. 确认 dist 目录有文件

### 问题 3：静态资源加载失败

**症状：** 网站打开了，但 CSS/JS/图片加载失败（404）

**原因：** base 路径配置不正确

**解决方法：**
1. 检查浏览器开发者工具的 Network 标签
2. 查看资源的请求 URL
3. 确认 URL 是否包含仓库名

**正确的 URL：**
```
https://username.github.io/repository-name/assets/index-xxx.js
```

**错误的 URL：**
```
https://username.github.io/assets/index-xxx.js  ❌ 缺少仓库名
```

### 问题 4：部署成功但内容没更新

**症状：** 推送了新代码，但网站还是显示旧内容

**解决方法：**
1. 清除浏览器缓存（Ctrl + F5 或 Cmd + Shift + R）
2. 等待几分钟（GitHub Pages 有缓存）
3. 检查 Actions 是否真的成功运行了

---

## 进阶配置

### 1. 自定义域名

如果您有自己的域名，可以配置：

1. 进入 **Settings** → **Pages**
2. 在 **Custom domain** 输入您的域名
3. 配置 DNS 记录：
   - 添加 CNAME 记录指向 `username.github.io`
4. 等待 DNS 验证完成
5. 勾选 **Enforce HTTPS**

### 2. 配置环境变量

如果您的项目需要环境变量：

**方法一：在工作流中定义**
```yaml
- name: Build
  env:
    VITE_BASE: '/${{ github.event.repository.name }}/'
    VITE_API_URL: 'https://api.example.com'
  run: npm run build
```

**方法二：使用 Repository Secrets**
1. 进入 **Settings** → **Secrets and variables** → **Actions**
2. 点击 "New repository secret"
3. 添加密钥
4. 在工作流中使用：
```yaml
env:
  VITE_API_KEY: ${{ secrets.API_KEY }}
```

### 3. 添加构建优化

**启用缓存：**
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '18'
    cache: 'npm'  # 缓存 node_modules
```

**并行构建：**
如果项目较大，可以使用并行构建来加速。

### 4. 添加部署通知

在工作流中添加通知步骤：

```yaml
- name: Notify deployment success
  if: success()
  run: echo "Deployment successful!"

- name: Notify deployment failure
  if: failure()
  run: echo "Deployment failed!"
```

### 5. 部署到不同环境

可以创建多个环境（如 staging, production）：

1. 进入 **Settings** → **Environments**
2. 创建新环境
3. 配置保护规则（需要审批等）
4. 在工作流中指定环境：
```yaml
jobs:
  deploy:
    environment: production
    runs-on: ubuntu-latest
```

---

## 检查清单

在完成部署后，使用这个清单检查：

### 配置检查
- [ ] `vite.config.ts` 配置了 `base` 路径
- [ ] `.github/workflows/deploy.yml` 文件存在且配置正确
- [ ] `package.json` 有 `build` 脚本
- [ ] `.gitignore` 包含 `node_modules/` 和 `dist/`

### GitHub 设置检查
- [ ] **Settings** → **Pages** → **Source** 设置为 **GitHub Actions**
- [ ] 工作流有正确的权限（contents, pages, id-token）
- [ ] 仓库是公开的，或者您有 GitHub Pro/Team/Enterprise 账号

### 部署检查
- [ ] 推送到 main 分支触发了工作流
- [ ] 工作流运行成功（绿色✅）
- [ ] 可以访问 GitHub Pages URL
- [ ] 网站内容正确显示
- [ ] 静态资源（CSS/JS/图片）正常加载

### 功能检查
- [ ] 所有页面都能正常访问
- [ ] 路由功能正常（如果使用了路由）
- [ ] API 调用正常（如果有）
- [ ] 响应式设计在移动端正常

---

## 总结

恭喜！您已经完成了从零开始部署 React + Vite 项目到 GitHub Pages 的全过程。

### 您学到了什么：

1. **清理环境**：如何清理旧的部署配置
2. **配置项目**：如何配置 Vite 的 base 路径
3. **创建工作流**：如何编写 GitHub Actions 工作流
4. **配置 Pages**：如何启用和配置 GitHub Pages
5. **部署和验证**：如何触发部署和验证结果
6. **故障排除**：如何解决常见问题

### 关键要点：

- ✅ 使用 GitHub Actions 方式部署（推荐）
- ✅ 配置正确的 base 路径
- ✅ 确保工作流有足够的权限
- ✅ 选择 "GitHub Actions" 作为部署源
- ✅ 善用 Actions 日志排查问题

### 下一步：

- 🚀 为项目添加自定义域名
- 🚀 配置 CI/CD 自动化测试
- 🚀 优化构建速度和包大小
- 🚀 添加部署前的代码检查

---

## 参考资源

- [GitHub Pages 官方文档](https://docs.github.com/zh/pages)
- [GitHub Actions 官方文档](https://docs.github.com/zh/actions)
- [Vite 官方文档](https://cn.vitejs.dev/)
- [部署静态站点到 GitHub Pages](https://cn.vitejs.dev/guide/static-deploy.html#github-pages)

---

**祝您部署顺利！** 🎉

如果遇到问题，可以：
1. 查看本指南的"故障排除"部分
2. 查看 GitHub Actions 的详细日志
3. 在仓库中创建 Issue
4. 参考官方文档
