# CI/CD Deployment Guide - cPanel SFTP/SSH

This guide explains how to set up automatic deployment to cPanel using GitHub Actions and SFTP/SSH.

## Overview

The workflow automatically deploys your code to cPanel whenever you push to the `main` branch. You can also trigger deployments manually from the GitHub Actions tab.

## Setup Instructions

### Step 1: Generate SSH Key Pair

1. Open terminal/PowerShell and run:
   ```bash
   ssh-keygen -t rsa -b 4096 -C "github-deploy" -f deploy_key
   ```
2. This creates two files:
   - `deploy_key` (private key) - Keep this secret!
   - `deploy_key.pub` (public key) - Add to cPanel

### Step 2: Add Public Key to cPanel

1. Log into your cPanel account
2. Go to **Security** → **SSH Access**
3. Click **Manage SSH Keys** → **Import Key**
4. Paste the contents of `deploy_key.pub` into the Public Key field
5. Click **Import**
6. Back on SSH Keys page, click **Manage** next to the key → **Authorize**

### Step 3: Get SSH/SFTP Details from cPanel

1. In cPanel, note down:
   - **Host**: Your server hostname (e.g., `server123.hostingprovider.com` or your domain)
   - **Username**: Your cPanel username (not email)
   - **Port**: Usually `22` for SSH (check with your host)
   - **Remote Path**: Full path to deployment folder (e.g., `/home/username/public_html/admin-panel/`)

### Step 4: Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add each of the following:

#### SSH/SFTP Credentials (Required)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `SSH_PRIVATE_KEY` | Contents of your `deploy_key` file (private key) | `-----BEGIN RSA PRIVATE KEY-----...` |
| `SSH_HOST` | Your server hostname | `server123.host.com` |
| `SSH_USERNAME` | cPanel username | `yourusername` |
| `SSH_PORT` | SSH port (usually 22) | `22` |
| `REMOTE_PATH` | Full path to deployment folder | `/home/username/public_html/admin/` |

#### Application Secrets (Required)

| Secret Name | Description |
|-------------|-------------|
| `MONGOURI` | MongoDB connection string |
| `SESSION_SECRET` | Express session secret |
| `PORT` | Application port (usually `3000`) |

#### TCS Courier Credentials

| Secret Name | Description |
|-------------|-------------|
| `TCS_BEARER` | TCS Bearer token |
| `TCS_ACCESS_TOKEN` | TCS Access token |

#### PostEx Credentials

| Secret Name | Description |
|-------------|-------------|
| `POSTEX_API_TOKEN` | PostEx API token |

#### Leopards Courier Credentials

| Secret Name | Description |
|-------------|-------------|
| `LEOPARDS_API_KEY` | Leopards API key |
| `LEOPARDS_API_PASSWORD` | Leopards API password |

#### M&P Courier Credentials

| Secret Name | Description |
|-------------|-------------|
| `MNP_USERNAME` | M&P username |
| `MNP_PASSWORD` | M&P password |
| `MNP_ACCOUNT_NO` | M&P account number |
| `MNP_LOCATION_ID` | M&P location ID |

#### Admin Credentials

| Secret Name | Description |
|-------------|-------------|
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD` | Admin login password |

#### Cloudinary Credentials

| Secret Name | Description |
|-------------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_URL` | Full Cloudinary URL |

#### Other

| Secret Name | Description |
|-------------|-------------|
| `LANDING_API_KEY` | Landing page API key |

### Step 3: Configure Node.js on cPanel

1. In cPanel, go to **Software** → **Setup Node.js App**
2. Click **Create Application**
3. Configure:
   - **Node.js version**: 20.x (or latest LTS)
   - **Application mode**: Production
   - **Application root**: Path to your deployed files (e.g., `public_html/admin-panel`)
   - **Application URL**: Your domain/subdomain
   - **Application startup file**: `server.js`
4. Click **Create**
5. After deployment, click **Run NPM Install** to install dependencies
6. Click **Restart** to start the application

### Step 4: Deploy

Once configured, deployment happens automatically:

1. Push code to the `main` branch
2. GitHub Actions will:
   - Checkout your code
   - Install dependencies
   - Create the `.env` file from secrets
   - Upload files via FTP to your cPanel server

### Manual Deployment

To deploy manually:
1. Go to your repository on GitHub
2. Click **Actions** tab
3. Select **Deploy to cPanel via FTP**
4. Click **Run workflow** → **Run workflow**

## Troubleshooting

### FTP Connection Failed
- Verify FTP server hostname is correct
- Check if your hosting allows FTP connections
- Try using passive mode (enabled by default)
- Ensure firewall isn't blocking FTP ports (21, 20)

### Permission Denied
- Verify FTP user has write permissions to the target directory
- Check if the remote directory exists
- Ensure the path ends with `/`

### Files Not Updating
- Clear browser cache
- Restart Node.js app in cPanel
- Check GitHub Actions logs for errors

### Node.js App Not Starting
- Verify `server.js` is the correct startup file
- Check application logs in cPanel
- Ensure all required environment variables are set
- Run `npm install` via cPanel Node.js interface

## File Structure After Deployment

```
/public_html/admin-panel/
├── api/
├── config/
├── models/
├── public/
├── views/
├── .env (created from secrets)
├── app.js
├── package.json
├── package-lock.json
└── server.js
```

## Security Notes

- Never commit `.env` file to the repository
- Regularly rotate FTP passwords
- Use strong passwords for all secrets
- Keep your cPanel and Node.js versions updated
