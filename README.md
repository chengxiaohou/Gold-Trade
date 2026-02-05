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

---

如果你同意，我可以帮你：

1. 生成推送到 GitHub 的 git 命令（`git remote add` / `git push`）并显示给你（不自动执行）。
2. 在合适位置添加 `LICENSE`、`.gitignore` 或进一步的 CI 校验（测试、lint）。

需要我继续帮你把代码推到 GitHub 吗？（我不会在未得到你允许的情况下运行任何 git 操作）
