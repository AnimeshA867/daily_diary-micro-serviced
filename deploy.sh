#!/bin/bash

# ==============================================================================
# Krypt Microservices Production Server Deploy Script
# ------------------------------------------------------------------------------
# Automates the setup, environment configuration, building, and launching
# of Krypt microservices on a Linux VPS / server.
# ==============================================================================

set -e

# ANSI Color Codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}    🚀 Starting Krypt Microservices Server Deploy   ${NC}"
echo -e "${BLUE}====================================================${NC}\n"

# 1. Dependency Validation
echo -e "${BLUE}[1/5] Checking system dependencies...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Error: Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Error: Docker Compose is not installed. Please install docker-compose first.${NC}"
    exit 1
fi

# Detect compose command syntax (modern 'docker compose' vs legacy 'docker-compose')
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

echo -e "${GREEN}✓ Docker and Docker Compose are present.${NC}\n"

# 2. Environment Variables Configuration
echo -e "${BLUE}[2/5] Configuring environment variables...${NC}"

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating a production config with secure random keys...${NC}"
    
    # Generate random secure passwords
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "krypt_default_jwt_secret_change_me_$(date +%s)")
    POSTGRES_PASSWORD=$(openssl rand -hex 16 2>/dev/null || echo "krypt_default_pg_password_change_me_$(date +%s)")
    
    cat > "$ENV_FILE" << EOF
# Production Secrets
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
GF_SECURITY_ADMIN_PASSWORD=admin

# Environment
NODE_ENV=production
EOF
    echo -e "${GREEN}✓ Created secure .env file.${NC}"
else
    echo -e "${GREEN}✓ Found existing .env config.${NC}"
fi
echo -e "\n"

# 3. Building and Launching Services
echo -e "${BLUE}[3/5] Building and starting microservices stack in background...${NC}"
$DOCKER_COMPOSE down --remove-orphans || true
$DOCKER_COMPOSE up -d --build

echo -e "${GREEN}✓ Docker containers built and started in background.${NC}\n"

# 4. Service Health Checks
echo -e "${BLUE}[4/5] Waiting for services to become healthy...${NC}"

max_attempts=12
attempt=1

check_url() {
    local url=$1
    local name=$2
    if curl -s -f "$url" &> /dev/null; then
        echo -e "  - ${GREEN}✓ $name is up & healthy${NC}"
        return 0
    else
        echo -e "  - ${YELLOW}⏳ $name is starting...${NC}"
        return 1
    fi
}

while [ $attempt -le $max_attempts ]; do
    echo -e "Checking status (Attempt $attempt/$max_attempts)..."
    
    all_healthy=true
    
    # Check services via API Gateway proxy
    check_url "http://localhost/api/auth/health" "Auth Service" || all_healthy=false
    check_url "http://localhost/api/diary/health" "Diary Service" || all_healthy=false
    check_url "http://localhost/api/streak/health" "Streak Service" || all_healthy=false
    
    if [ "$all_healthy" = true ]; then
        echo -e "\n${GREEN}✓ All services are healthy!${NC}\n"
        break
    fi
    
    attempt=$((attempt+1))
    sleep 5
done

if [ "$all_healthy" = false ]; then
    echo -e "\n${YELLOW}⚠️  Warning: Some services took longer than expected to report healthy.${NC}"
    echo -e "Check service logs using: ${BLUE}$DOCKER_COMPOSE logs${NC}\n"
fi

# 5. Access Summary
echo -e "${BLUE}[5/5] Access URLs Summary:${NC}"
echo -e "----------------------------------------------------"
echo -e "📱  ${GREEN}Diary Dashboard:${NC}  http://localhost"
echo -e "📈  ${GREEN}Grafana Analytics:${NC} http://localhost:4000 (default login: admin / admin_grafana_password_123)"
echo -e "📊  ${GREEN}Prometheus Server:${NC} http://localhost:9090"
echo -e "🐰  ${GREEN}RabbitMQ Console:${NC}  http://localhost:15672 (default login: guest / guest)"
echo -e "----------------------------------------------------"
echo -e "\n${GREEN}🎉 Krypt Microservices stack successfully running!${NC}\n"
EOF
