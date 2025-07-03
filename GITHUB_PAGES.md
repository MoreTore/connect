# GitHub Pages Deployment

This project is configured to automatically deploy to GitHub Pages when changes are pushed to the `master` branch.

## Setup Instructions

1. **Enable GitHub Pages in your repository:**
   - Go to your repository on GitHub
   - Navigate to Settings → Pages
   - Under "Source", select "GitHub Actions"

2. **Push your changes:**
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push origin master
   ```

3. **Monitor the deployment:**
   - Go to the "Actions" tab in your GitHub repository
   - You should see the "Deploy to GitHub Pages" workflow running
   - Once complete, your site will be available at: `https://commaai.github.io/connect/`

## Workflow Details

The deployment workflow (`deploy.yaml`) does the following:

1. **Build Job:**
   - Checks out the code
   - Sets up PNPM and Node.js
   - Installs dependencies with `pnpm install`
   - Builds the project for production with `pnpm build:production`
   - Uploads the built files as an artifact

2. **Deploy Job:**
   - Downloads the build artifact
   - Deploys it to GitHub Pages

## Configuration

- **Base Path:** The Vite config is set to use `/connect/` as the base path in production mode, which matches the GitHub Pages URL structure for project repositories.
- **Build Output:** The `dist/` folder is deployed to GitHub Pages.
- **Permissions:** The workflow has the necessary permissions to deploy to GitHub Pages.

## Manual Deployment

You can also trigger a deployment manually:
1. Go to the Actions tab in your repository
2. Select the "Deploy to GitHub Pages" workflow
3. Click "Run workflow"

## Troubleshooting

- **404 errors:** Make sure the base path in `vite.config.js` matches your repository name
- **Build failures:** Check the Actions tab for detailed error logs
- **Permissions:** Ensure GitHub Pages is enabled and set to "GitHub Actions" as the source
