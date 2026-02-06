# Auto-merge Implementation for main → action-test

This directory contains the GitHub Actions workflow that automatically merges code from the `main` branch to the `action-test` branch.

## Implementation Overview

**File:** `.github/workflows/auto-merge-to-action-test.yml`

### How It Works

When code is pushed to the `main` branch:
1. The workflow is automatically triggered
2. The repository is checked out with full history
3. Git user credentials are configured
4. The `action-test` branch is verified/created
5. `main` branch is merged into `action-test`
6. Changes are pushed to the `action-test` branch

### Features

✅ **Automatic Trigger** - Runs on every push to main  
✅ **Branch Creation** - Creates action-test branch if it doesn't exist  
✅ **Conflict Detection** - Fails gracefully with clear error messages  
✅ **Security** - Uses minimal required permissions (contents: write)  
✅ **Exact Branch Matching** - Prevents accidental merges to wrong branches  

### Workflow Status

You can monitor the workflow execution in the **Actions** tab of your GitHub repository.

### Handling Merge Conflicts

If the automatic merge fails due to conflicts:
1. The workflow will stop and show an error message
2. You'll need to manually resolve the conflicts
3. Steps to resolve:
   ```bash
   git checkout action-test
   git pull origin action-test
   git merge main
   # Resolve conflicts in your editor
   git add .
   git commit
   git push origin action-test
   ```

### Alternative Implementations

See `AUTO_MERGE_SOLUTIONS.md` (in Chinese) for a detailed discussion of 5 different implementation approaches and their trade-offs.

## Testing

To test this workflow:
1. Make a change to any file
2. Commit and push to the `main` branch
3. Check the Actions tab to see the workflow run
4. Verify that the `action-test` branch has been updated

## Troubleshooting

**Workflow not triggering?**
- Ensure you're pushing to the `main` branch
- Check that GitHub Actions is enabled for the repository

**Merge failing?**
- Check the Actions log for detailed error messages
- Look for merge conflicts that need manual resolution
- Verify branch permissions are correctly configured

**Permission errors?**
- Ensure the repository has Actions enabled
- Check that the GITHUB_TOKEN has sufficient permissions
