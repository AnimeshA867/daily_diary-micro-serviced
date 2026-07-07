# Krypt 📔 - System Design & Architecture Presentation

This presentation document details the architecture, design choices, data flow mechanisms, and future cloud-native roadmaps for the **Krypt Secure Diary Application**.

---

## 🗺️ 1. Current Microservices Architecture & Data Flow
The current system operates as a decoupled, multi-container microservices application. Below is the active data flow routing requests through the Nginx gateway down to the respective databases, cache stores, and event brokers.

### System Architecture Flowchart
```mermaid
graph TD
    %% Define Node Styles
    classDef client fill:#5D3FD3,stroke:#fff,stroke-width:2px,color:#fff;
    classDef gateway fill:#1E88E5,stroke:#fff,stroke-width:2px,color:#fff;
    classDef service fill:#43A047,stroke:#fff,stroke-width:2px,color:#fff;
    classDef database fill:#E53935,stroke:#fff,stroke-width:2px,color:#fff;
    classDef broker fill:#FB8C00,stroke:#fff,stroke-width:2px,color:#fff;
    classDef monitor fill:#8E24AA,stroke:#fff,stroke-width:2px,color:#fff;

    %% Nodes
    User[📱 Client Browser]:::client
    Gateway[🌐 Nginx API Gateway]:::gateway
    
    AuthService[🔐 Auth Service\nExpress - Port 5001]:::service
    DiaryService[📓 Diary Service\nExpress - Port 5002]:::service
    StreakService[🔥 Streak Service\nExpress - Port 5003]:::service
    Frontend[💻 Frontend UI\nNext.js - Port 3000]:::service
    
    DB[(PostgreSQL\nAuth & Public schemas)]:::database
    Redis[(Redis\nStreak Cache)]:::database
    RabbitMQ{🐰 RabbitMQ\nMessage Broker}:::broker
    
    Prometheus[⏰ Prometheus Scraper]:::monitor
    Grafana[📊 Grafana Visualizer]:::monitor

    %% Data Flow Connections
    User -->|HTTP / HTML / Static assets| Gateway
    Gateway -->|/| Frontend
    Gateway -->|/api/auth/*| AuthService
    Gateway -->|/api/diary/*| DiaryService
    Gateway -->|/api/streak/*| StreakService

    %% Microservices to DB/Queue Connections
    AuthService -->|Queries credentials & salts| DB
    DiaryService -->|Saves encrypted diary entries| DB
    DiaryService -->|Publishes 'diary.entry.saved'| RabbitMQ
    
    RabbitMQ -->|Consumes streak updates| StreakService
    StreakService -->|Queries entry history| DB
    StreakService -->|Reads/Writes cached statistics| Redis

    %% Monitoring Scrapes
    Prometheus -->|Scrapes /metrics| AuthService
    Prometheus -->|Scrapes /metrics| DiaryService
    Prometheus -->|Scrapes /metrics| StreakService
    Grafana -->|Displays charts| Prometheus
```

---

## 🔒 2. Zero-Knowledge Cryptography Data Flow
Security is built into Krypt using a **Zero-Knowledge client-side architecture**. The server stores the ciphertexts but holds no decryption capability.

### Cryptographic Lifecycle Sequence
```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant Gateway as API Gateway
    participant Auth as Auth Microservice
    participant Diary as Diary Microservice
    participant DB as PostgreSQL DB

    %% Key Derivation
    User->>Gateway: POST /api/auth/register (Email, Password)
    Gateway->>Auth: Forward to Auth Service
    Note over Auth: Generate unique Cryptographic Salt
    Auth->>DB: Save User Credentials & Salt
    Auth-->>User: Success (Return JWT Session Cookie)

    %% Encrypting and Saving
    Note over User: User writes diary entry.<br/>Derive Encryption Key locally via PBKDF2<br/>using Password & retrieved Salt.
    Note over User: Encrypt plaintext using AES-GCM 256-bit<br/>with derived Key + unique random IV.
    User->>Gateway: POST /api/diary/entries (Encrypted Content, IV)
    Gateway->>Diary: Forward to Diary Service
    Diary->>DB: Insert Encrypted Entry (Zero-Knowledge)
    Note over DB: Content is ciphertext.<br/>DB Admin cannot read it.
    DB-->>User: Entry Saved Confirmation
```

---

## ☸️ 3. Scaling with Kubernetes (Orchestration Pipeline)
When moving from Docker Compose to a clustered cloud environment, Kubernetes orchestrates the microservices natively. 

### Kubernetes Architecture Model
```mermaid
graph TB
    %% Styles
    classDef k8s fill:#326CE5,stroke:#fff,stroke-width:2px,color:#fff;
    classDef pod fill:#4CAF50,stroke:#fff,stroke-width:2px,color:#fff;
    classDef storage fill:#FF9800,stroke:#fff,stroke-width:2px,color:#fff;

    %% Nodes
    Ingress[🛰️ K8s Ingress Controller\ne.g., Ingress-Nginx]:::k8s
    
    ServiceFront[Service: Frontend]:::k8s
    ServiceAuth[Service: Auth]:::k8s
    ServiceDiary[Service: Diary]:::k8s
    ServiceStreak[Service: Streak]:::k8s
    
    PodFront[Pod: Frontend Next.js]:::pod
    PodAuth[Pod: Auth Service]:::pod
    PodDiary[Pod: Diary Service]:::pod
    PodStreak[Pod: Streak Service]:::pod
    
    ConfigSecret[ConfigMap & Secrets\nJWT_SECRET / Database URI]:::k8s
    
    PVC[(Persistent Volume Claim\nPostgres Storage)]:::storage

    %% Routing
    Ingress -->|Path: /| ServiceFront
    Ingress -->|Path: /api/auth| ServiceAuth
    Ingress -->|Path: /api/diary| ServiceDiary
    Ingress -->|Path: /api/streak| ServiceStreak
    
    ServiceFront --> PodFront
    ServiceAuth --> PodAuth
    ServiceDiary --> PodDiary
    ServiceStreak --> PodStreak
    
    %% Config Mounts
    ConfigSecret -.->|Injects environment| PodFront
    ConfigSecret -.->|Injects environment| PodAuth
    ConfigSecret -.->|Injects environment| PodDiary
    ConfigSecret -.->|Injects environment| PodStreak

    %% Stateful volumes
    PodDiary -->|Claims PVC| PVC
```

### Key Kubernetes Benefits for Krypt:
1. **ConfigMaps & Secrets Decoupling**: Application settings are decoupled from source code, injected dynamically into container namespaces.
2. **Horizontal Pod Autoscaling (HPA)**: If diary writes spike, Kubernetes scales the `diary-service` pod count from 1 to 5 dynamically based on CPU/Memory load.
3. **Self-Healing Pods**: If a microservice crashes or experiences memory leaks, Kubernetes immediately terminates the pod and spins up a new instance.
4. **Zero-Downtime Rolling Updates**: Deploy updates to individual microservices container images one pod at a time without interrupting frontend user traffic.

---

## ⚡ 4. Cloud Serverless Architecture (Future Roadmap)
For the lowest operational overhead, high scaling potential, and pay-per-execution billing, Krypt can be migrated to a **Serverless cloud architecture on AWS**.

### Serverless Architecture Diagram
```mermaid
graph TD
    classDef client fill:#5D3FD3,stroke:#fff,stroke-width:2px,color:#fff;
    classDef aws fill:#FF9900,stroke:#fff,stroke-width:2px,color:#fff;
    classDef func fill:#D81B60,stroke:#fff,stroke-width:2px,color:#fff;
    classDef db fill:#1E88E5,stroke:#fff,stroke-width:2px,color:#fff;

    User[📱 Client Browser]:::client
    CF[🌐 Amazon CloudFront CDN]:::aws
    S3[🗂️ Amazon S3 Bucket\nNext.js Static Export]:::aws
    
    APIGW[🛡️ Amazon API Gateway]:::aws
    
    LambdaAuth[λ Lambda Function\nAuth / User Actions]:::func
    LambdaDiary[λ Lambda Function\nDiary Actions]:::func
    LambdaStreak[λ Lambda Function\nStreak Calculations]:::func
    
    SQS[✉️ Amazon SQS\nMessage Queue]:::aws
    
    RDS[(Amazon RDS Aurora Serverless\nPostgreSQL Database)]:::db
    ElastiCache[(Amazon ElastiCache Serverless\nRedis Cache)]:::db

    %% Routing
    User -->|Fetch static HTML/JS/CSS| CF
    CF --> S3
    
    User -->|API Requests: /api/*| APIGW
    
    APIGW -->|Route: /api/auth| LambdaAuth
    APIGW -->|Route: /api/diary| LambdaDiary
    APIGW -->|Route: /api/streak| LambdaStreak
    
    %% Lambda Operations
    LambdaAuth --> RDS
    LambdaDiary --> RDS
    
    %% Async Event Messaging
    LambdaDiary -->|Enqueue event| SQS
    SQS -->|Trigger invocation| LambdaStreak
    
    LambdaStreak --> RDS
    LambdaStreak --> ElastiCache
```

### Migration Blueprint to Serverless:
To migrate this codebase to AWS Serverless:
1. **Refactor HTTP Framework to Handler Functions**:
   Replace the Express `app.listen()` and router setup in `services/*/src/index.ts` with serverless adapters (like `@vendia/serverless-express` or standard AWS handler entrypoints).
2. **Next.js Static Export**:
   Build the Next.js frontend as a static export (`output: 'export'`) and host the assets on an **Amazon S3** bucket fronted by **CloudFront CDN** for instant edge performance.
3. **Swap RabbitMQ with Amazon SQS**:
   Replace the `amqplib` messaging logic in the Diary & Streak services with the AWS SDK calling **Amazon SQS** queues or **Amazon EventBridge**. This eliminates the need to run, manage, and patch message broker nodes.
4. **Database Migration**:
   Connect the Lambda functions to **Amazon RDS Aurora Serverless v2 (PostgreSQL)**, which scales connection pools automatically and scales capacity to zero when not in use.
5. **Caching Migration**:
   Point your Redis connection URLs to **Amazon ElastiCache Serverless (Redis)** to handle memory caches without managing servers.
