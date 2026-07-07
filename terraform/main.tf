# ==============================================================================
# Terraform Infrastructure as Code (IaC) Boilerplate for Krypt Microservices
# ------------------------------------------------------------------------------
# This configuration acts as a reference outline to deploy Krypt to AWS.
# Fill in the commented resource arguments to configure EKS, RDS, and VPC.
# ==============================================================================

terraform {
  required_version = ">= 1.5.0"
  
  # Configure remote backend for storing state securely (e.g., S3 + DynamoDB lock)
  backend "s3" {
    bucket         = "my-krypt-tf-state-bucket"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "my-krypt-tf-state-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ------------------------------------------------------------------------------
# 1. Network Layer (VPC & Subnets)
# ------------------------------------------------------------------------------

# Define a VPC to isolate our microservices environment
resource "aws_vpc" "krypt_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "krypt-vpc"
    Environment = var.environment
  }
}

# Public Subnets (for Ingress Gateway / Load Balancer)
# resource "aws_subnet" "public_1" { ... }
# resource "aws_subnet" "public_2" { ... }

# Private Subnets (for Microservices, RDS, and Redis)
# resource "aws_subnet" "private_1" { ... }
# resource "aws_subnet" "private_2" { ... }

# Internet Gateway for Public Subnets
# resource "aws_internet_gateway" "igw" { ... }

# NAT Gateway (in Public Subnet) to allow Private Subnet services to access external services (e.g. image downloads, packages)
# resource "aws_nat_gateway" "nat" { ... }

# Route Tables & Associations
# resource "aws_route_table" "public" { ... }
# resource "aws_route_table" "private" { ... }

# ------------------------------------------------------------------------------
# 2. Database & Cache Layer (RDS Postgres & ElastiCache Redis)
# ------------------------------------------------------------------------------

# Subnet Group for the Postgres RDS database (requires private subnets in 2 AZs)
# resource "aws_db_subnet_group" "rds" { ... }

# AWS RDS PostgreSQL Instance (replaces the local postgres container)
# resource "aws_db_instance" "postgres" {
#   allocated_storage    = 20
#   max_allocated_storage = 100
#   engine               = "postgres"
#   engine_version       = "15"
#   instance_class       = "db.t4g.micro" # Burstable instance for low-cost portfolio hosting
#   db_name              = "krypt"
#   username             = var.db_username
#   password             = var.db_password # Use Secret Manager or input variables
#   db_subnet_group_name = aws_db_subnet_group.rds.name
#   vpc_security_group_ids = [aws_security_group.db_sg.id]
#   skip_final_snapshot  = true
# }

# AWS ElastiCache Serverless (Redis) / Cache Cluster (replaces the local Redis container)
# resource "aws_elasticache_cluster" "redis" {
#   cluster_id           = "krypt-redis"
#   engine               = "redis"
#   node_type            = "cache.t4g.micro"
#   num_cache_nodes      = 1
#   parameter_group_name = "default.redis7"
#   port                 = 6379
#   subnet_group_name    = aws_elasticache_subnet_group.redis.name
#   security_group_ids   = [aws_security_group.redis_sg.id]
# }

# ------------------------------------------------------------------------------
# 3. Compute Layer (AWS EKS - Elastic Kubernetes Service)
# ------------------------------------------------------------------------------

# IAM Role for EKS Cluster control plane
# resource "aws_iam_role" "eks_cluster_role" { ... }

# EKS Cluster Control Plane
# resource "aws_eks_cluster" "krypt_cluster" {
#   name     = "krypt-cluster"
#   role_arn = aws_iam_role.eks_cluster_role.arn
#   
#   vpc_config {
#     subnet_ids = [
#       aws_subnet.private_1.id,
#       aws_subnet.private_2.id
#     ]
#   }
# }

# IAM Role for EKS Node Groups
# resource "aws_iam_role" "eks_node_role" { ... }

# EKS Node Group (executes frontend, auth, diary, and streak containers)
# resource "aws_eks_node_group" "krypt_node_group" {
#   cluster_name    = aws_eks_cluster.krypt_cluster.name
#   node_group_name = "krypt-nodes"
#   node_role_arn   = aws_iam_role.eks_node_role.arn
#   subnet_ids      = [aws_subnet.private_1.id, aws_subnet.private_2.id]
#   
#   scaling_config {
#     desired_size = 2
#     max_size     = 3
#     min_size     = 1
#   }
#   
#   instance_types = ["t3.medium"] # Budget-friendly, standard size for small clusters
# }

# ------------------------------------------------------------------------------
# 4. Security Groups (Firewall configuration)
# ------------------------------------------------------------------------------

# Security Group for Database (allows traffic only from the EKS nodes)
# resource "aws_security_group" "db_sg" {
#   vpc_id = aws_vpc.krypt_vpc.id
#   ingress {
#     from_port       = 5432
#     to_port         = 5432
#     protocol        = "tcp"
#     security_groups = [aws_eks_cluster.krypt_cluster.vpc_config[0].cluster_security_group_id]
#   }
# }
