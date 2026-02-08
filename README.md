<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1izNp2BctmdlxgRVkAIVEic79H2TegVYU

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key (仅限本地测试，切勿将真实密钥打包并提交到公开仓库)
3. Run the app:
   `npm run dev`

## 部署到 GitHub Pages ✅

1. 在 GitHub 上新建仓库（或在本仓库启用远程）。
   - 使用 GitHub CLI（可选）：
     `gh repo create <OWNER>/<REPO> --public --source=. --remote=origin --push`（*需要你确认后执行*）
2. 我已添加 GitHub Actions workflow：`.github/workflows/deploy.yml`，当你将代码推到 `main` 分支时，Actions 会自动构建并把 `dist` 部署到 GitHub Pages。页面地址为：
   `https://<YOUR_GITHUB_USERNAME>.github.io/<REPO>/`
3. 注意事项 ⚠️：
   - 前端不应包含敏感密钥（例如 `GEMINI_API_KEY`）。若需要调用第三方私有 API，请实现一个后端代理或 serverless 函数来保护密钥。
   - 如果你需要自定义域名，请到仓库的 GitHub Pages 设置中配置自定义域。

**自动部署说明**：目前 workflow 会在 `main` 与 `Action-Test` 分支有 push 时触发部署；你也可以在 Actions 页面使用 "Run workflow" 手动触发并选择想要的分支。

## 🔄 一键合并 Main 到 Action-Test 分支

如果你需要将 `main` 分支的最新代码合并到 `Action-Test` 分支，可以使用 GitHub Actions 一键操作：

### 使用方法：
1. 打开仓库的 **Actions** 标签页
2. 在左侧工作流列表中，选择 **"🔄 Merge Main to Action-Test"**
3. 点击右上角的 **"Run workflow"** 按钮
4. 确认分支为默认分支，点击绿色的 **"Run workflow"** 按钮
5. 等待工作流执行完成（通常只需几秒钟）

### 特点：
- ✅ **完全自动化**：无需本地操作，一键完成合并
- ✅ **不修改 main**：只会将 main 的代码合并到 Action-Test，不会改动 main 分支
- ✅ **冲突检测**：如果发生合并冲突，工作流会失败并提示手动解决
- ✅ **安全可靠**：使用 GitHub Actions 官方机器人账号执行，有完整的日志记录

### 工作流文件位置：
`.github/workflows/code-sync-publish.yml`

---

如果你同意，我可以帮你：

1. 生成推送到 GitHub 的 git 命令（`git remote add` / `git push`）并显示给你（不自动执行）。
2. 在合适位置添加 `LICENSE`、`.gitignore` 或进一步的 CI 校验（测试、lint）。

需要我继续帮你把代码推到 GitHub 吗？（我不会在未得到你允许的情况下运行任何 git 操作）
