# Krypt 📔 - Secure Diary Microservices App

A secure, zero-knowledge end-to-end encrypted personal diary application restructured from a Next.js monolith into a self-hosted microservices architecture. Designed for easy orchestration via **Docker Compose** and **Kubernetes**, with built-in event-driven queue updates, monitoring dashboard scrapers, and Cloud IaC templates.

---

## 🔒 Security Features
* **Zero-Knowledge Encryption**: Encryption/decryption (AES-GCM 256-bit with PBKDF2 key derivation) is executed **strictly in the browser** using the Web Crypto API. Plaint-text contents never leave your device.
* **Salt storage**: Personal salts are securely stored in the database but the backend cannot read or decrypt the entry content.
* **HTTP-Only Session Cookies**: Session validation using cryptographically signed JWTs.

---

## 🏗️ Architecture
Krypt is divided into decoupled microservices:

1. **Frontend Service (`services/frontend`)**: Next.js App Router UI.
2. **Auth Service (`services/auth`)**: Express API managing login/registration, JWT sessions, user profiles, and encryption salts.
3. **Diary Service (`services/diary`)**: Handles entry CRUD. On updates, publishes a `diary.entry.saved` message to RabbitMQ.
4. **Streak Service (`services/streak`)**: Consumes RabbitMQ events, invalidates Redis caches, and recalculates streaks.
5. **Nginx API Gateway (`gateway`)**: Routes public HTTP traffic to services (or Ingress on Kubernetes).
6. **RabbitMQ Broker**: Handles async task queue orchestration.
7. **Redis Cache**: Speed-up queries for streak analytics.
8. **Prometheus & Grafana**: Scraping and dashboard visualizing tools.

---

## 🚀 Running the Application

### 🐳 Quick Start: Run on a Production Server or Locally
We include a helper script to build and run the entire stack:

```bash
# 1. Run the deploy script
bash deploy.sh
```

The script will automatically:
1. Verify system dependencies (`docker`, `compose`).
2. Generate secure production secrets inside a `.env` file.
3. Build and launch all services in background daemon mode.
4. Wait for and verify healthcheck endpoints.

#### Dashboard Access Summary:
* **Diary Web Interface**: `http://localhost` (Port 80)
* **Grafana Dashboards**: `http://localhost:4000` (default credentials: `admin` / `admin_grafana_password_123`)
* **Prometheus Console**: `http://localhost:9090`
* **RabbitMQ Management**: `http://localhost:15672` (default credentials: `guest` / `guest`)

---

## ☸️ Kubernetes Deployment
Kubernetes manifests are located in [k8s/](./k8s/).

To deploy to Minikube or a cloud-managed cluster (e.g. AWS EKS / GCP GKE):
```bash
# 1. Create namespace
kubectl apply -f k8s/namespace.yaml

# 2. Deploy secrets, configs, databases, and microservices
kubectl apply -f k8s/
```

Verify service pods:
```bash
kubectl get pods -n krypt
```

---

## ☁️ Cloud Readiness Boilerplates
To support production cloud migrations, we provide commented IAC and provisioning templates:
- **Terraform** ([terraform/](./terraform/)): Provisions virtual networks (VPC/subnets), RDS PostgreSQL, ElastiCache Redis, and EKS Kubernetes clusters.
- **Ansible** ([ansible/](./ansible/)): Provisioning playbooks to install Docker and automatically deploy the Docker Compose stack onto a Linux VPS.
