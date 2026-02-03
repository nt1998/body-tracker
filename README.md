# Body Tracker

PWA for tracking body metrics with GitHub sync.

## Development

```bash
npm install
npm run dev
```

## Deploy

### Automatic Deployment

The app automatically deploys to GitHub Pages when changes are pushed to the `main` branch via GitHub Actions workflow.

You can also manually trigger a deployment from the Actions tab in GitHub.

### Manual Deployment

```bash
npm run deploy
```

This builds the app and pushes to the `gh-pages` branch.

### GitHub Pages Setup

1. Go to repo Settings > Pages
2. Source: Deploy from a branch
3. Branch: `gh-pages` / `/ (root)`
4. Save

Live at: https://nt1998.github.io/body-tracker
