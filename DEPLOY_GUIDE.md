# Production Deployment Guide - Krypt Microservices

This document provides a step-by-step manual guide to deploy the Krypt secure diary microservices application onto a Linux virtual server (VPS) (e.g. AWS EC2, DigitalOcean Droplet, Linode) using **Docker Compose** or **Kubernetes**.

---

## 📋 Prerequisites
Before beginning, ensure your server meets the following requirements:
* **Operating System**: Linux (Alma Linux 9 recommended, or standard RHEL/CentOS/Ubuntu)
* **Hardware**: Minimum 2 Cores CPU, 4GB RAM (required to run standard PostgreSQL, Redis, RabbitMQ, Next.js, and Prometheus/Grafana containers together smoothly)
* **Firewall Ports**: open port `80` (HTTP), `443` (HTTPS - optional for SSL), `4000` (Grafana), `15672` (RabbitMQ Management - optional)

---

## 🛠️ Step 1: Server Setup & Dependencies
Install Docker and Docker Compose on your remote server instance.

### Option A: Alma Linux / RHEL / CentOS (Recommended)
```bash
# 1. Update system package index
sudo dnf update -y

# 2. Install yum-utils (provides config-manager utility)
sudo dnf install -y yum-utils

# 3. Add official Docker CE repository
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 4. Install Docker Engine, CLI, Containerd, and Compose Plugin
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 5. Enable and start the Docker service
sudo systemctl enable --now docker

# 6. Configure firewalld rules for traffic ingress
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=4000/tcp   # Grafana Analytics
sudo firewall-cmd --permanent --add-port=15672/tcp  # RabbitMQ Management
sudo firewall-cmd --reload

# 7. Add user to docker group (run docker commands without sudo)
sudo usermod -aG docker $USER
newgrp docker
```

### Option B: Ubuntu / Debian
```bash
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

Verify installations:
```bash
docker --version
docker compose version
```

---

## 📂 Step 2: Transfer Application Code
Transfer the Krypt application codebase to your server using Git or SSH copy (`rsync`/`scp`).

**Method A: Git Clone**
```bash
git clone <your-repository-url> /opt/krypt
cd /opt/krypt
```

**Method B: SCP Sync from Local Machine**
```bash
rsync -avz --exclude="node_modules" --exclude=".next" --exclude="dist" -e "ssh -i ~/.ssh/server_key.pem" ./ ubuntu@your-server-ip:/opt/krypt
```

---

## 🔑 Step 3: Setup Production Environment Configuration
Create a secure production `.env` file in the root directory `/opt/krypt/`:

```bash
cd /opt/krypt
nano .env
```

Add the following environment variables. **Ensure you replace the values with secure, randomly generated secrets**:

```ini
# Shared JWT secret key (must be matching across Auth, Diary, Streak, and Frontend)
JWT_SECRET=generate_a_random_sha256_or_hex_key_here

# PostgreSQL database admin password
POSTGRES_PASSWORD=generate_a_secure_postgres_password_here

# Grafana admin panel password
GF_SECURITY_ADMIN_PASSWORD=secure_grafana_dashboard_password_here

# Production Flag
NODE_ENV=production
```

> [!TIP]
> You can generate a random secret key using:
> `openssl rand -hex 32`

---

## 🚀 Step 4: Build and Deploy using Docker Compose
Start the compilation and containerization process. Docker Compose will build custom Dockerfiles for the Next.js frontend, Auth, Diary, and Streak services, pulling PostgreSQL, Redis, RabbitMQ, and Nginx.

```bash
# Start building and running containers in detached (background) mode
docker compose up -d --build
```

### Checking Deployment Status
Verify that all 10 containers are running:
```bash
docker compose ps
```

You should see:
* `krypt-postgres` (Healthy)
* `krypt-redis` (Healthy)
* `krypt-rabbitmq` (Healthy)
* `krypt-auth-service` (Running)
* `krypt-diary-service` (Running)
* `krypt-streak-service` (Running)
* `krypt-frontend-service` (Running)
* `krypt-api-gateway` (Running)
* `krypt-prometheus` (Running)
* `krypt-grafana` (Running)

Check live logs to trace connections:
```bash
# Watch logs for auth or diary
docker compose logs -f krypt-auth-service
docker compose logs -f krypt-diary-service
```

---

## 🔒 Step 5: Setup SSL/TLS Certificate (Recommended)
To expose your app securely over HTTPS in a production environment, configure Nginx to use SSL using Let's Encrypt:

1. Install Certbot on the server:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```
2. Update Nginx gateway to listen to your domain name.
3. Run Certbot to generate and install SSL certificates:
   ```bash
   sudo certbot --nginx -d yourdiarydomain.com
   ```

---

## 📈 Step 6: Verify Monitoring & Metrics
Krypt has pre-configured metrics endpoints.

1. **Prometheus Scraping**: Open `http://<your-server-ip>:9090/targets` to verify that scrapers are successfully pulling `/metrics` data from `auth-service`, `diary-service`, and `streak-service`.
2. **Grafana Dashboards**: Access Grafana at `http://<your-server-ip>:4000`. Login with username `admin` and your configured password. You can create metrics dashboards pulling from the Prometheus datasource.

---

## 🐳 Step 7: Troubleshooting Common Issues

### 1. Database Connection Failures
If services fail to connect to PostgreSQL on startup, ensure the database container health checks are passing. The Express apps will wait for the postgres container status to be `service_healthy`.
Check logs:
```bash
docker compose logs krypt-postgres
```

### 2. RabbitMQ Connection Retries
Express microservices will attempt to connect to RabbitMQ up to 5 times with 5-second delays to wait for queue startup. If connections fail, check:
```bash
docker compose logs krypt-rabbitmq
```
Ensure ports `5672` (AMQP Broker) and `15672` (Management Web Console) are not conflicted.

### 3. SELinux Volume Mount Permission Issues (Alma Linux / RHEL / CentOS)
Because Alma Linux runs **SELinux** in `Enforcing` mode by default, Docker containers may experience permission denied issues when mounting host directories/files (e.g. `init-db.sql` or nginx configuration files).

**Symptoms**:
* Container logs show `Permission Denied` when reading config files or PostgreSQL initialization scripts.

**Solutions**:
1. **Append `:z` flag**: Tell Docker to automatically relabel the mounted directory contexts (already pre-configured in `docker-compose.yml` mounts). E.g.:
   ```yaml
   volumes:
     - ./gateway/nginx.conf:/etc/nginx/nginx.conf:ro,z
     - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro,z
   ```
2. **Apply SELinux labeling manually**: If issues persist, allow file access for container runtimes:
   ```bash
   sudo chcon -Rt svirt_sandbox_file_t /opt/krypt/
   ```
3. **Disable SELinux temporarily (diagnostics only)**:
   ```bash
   sudo setenforce 0
   ```

---

## 🔁 Step 8: Configuring CI/CD with GitHub Actions
Krypt is pre-configured with a GitHub Actions workflow pipeline in `.github/workflows/deploy.yml`.

### How it works:
1. **Lint & Build Verification**: On pushes and pull requests to `main`/`master`, the workflow compiles and tests all four services (Next.js frontend + three Express microservices) to catch compilation issues early.
2. **Docker Publish**: Upon merging/pushing directly to `main`, the workflow builds and publishes fresh Docker tags (`latest` and versioned with commit SHAs) to Docker Hub.
3. **Automated Server Pull & Deploy**: Runs SSH commands to connect to your remote VPS, pulls the updated container builds, and hot-swaps them.

### Settings required in GitHub Secrets:
Add the following secrets under your repository's **Settings > Secrets and variables > Actions > Repository secrets**:

| Secret Name | Description | Example / Value |
| :--- | :--- | :--- |
| `DOCKER_USERNAME` | Your Docker Hub account username | `my-docker-user` |
| `DOCKER_PASSWORD` | Docker Hub access token or password | `dckr_pat_...` |
| `SERVER_IP` | IPv4 address of your target server | `34.120.25.101` |
| `SERVER_USER` | Admin username on the server | `ubuntu` or `root` |
| `SSH_PRIVATE_KEY` | Private SSH key matching the target server's auth | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

