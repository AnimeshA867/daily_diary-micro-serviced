terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    ec2 = "http://localhost:4566"
    sts = "http://localhost:4566"
    iam = "http://localhost:4566"
  }
}

resource "aws_vpc" "krypt_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "krypt-vpc"
    Environment = var.environment
  }
}

resource "aws_subnet" "public_subnet" {
  vpc_id                  = aws_vpc.krypt_vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true

  tags = {
    Name = "krypt-public-subnet"
  }
}

resource "aws_security_group" "docker_sg" {
  name        = "krypt-docker-sg"
  description = "Allow HTTP, HTTPS, SSH, Grafana, and Loki"
  vpc_id      = aws_vpc.krypt_vpc.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 3100
    to_port     = 3100
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_key_pair" "krypt_key" {
  key_name   = "krypt-deploy-key"
  public_key = var.ssh_public_key
}

resource "aws_instance" "krypt_server" {
  ami           = var.ami_id
  instance_type = var.instance_type
  key_name      = aws_key_pair.krypt_key.key_name
  subnet_id     = aws_subnet.public_subnet.id

  vpc_security_group_ids = [aws_security_group.docker_sg.id]

  tags = {
    Name = "krypt-microservices-host"
  }
}


# Auto-generate Ansible Inventory
resource "local_file" "ansible_inventory" {
  content = templatefile("${path.module}/inventory.tpl", {
    instance_ip  = aws_instance.krypt_server.public_ip
    instance_id  = aws_instance.krypt_server.id
    ssh_key_path = var.ssh_key_path
    ansible_user = var.ansible_user
  })

  filename = "${path.module}/../ansible/inventory.ini"

  # Recreate file whenever instance changes
  file_permission = "0644"
}

output "ansible_inventory_path" {
  value       = local_file.ansible_inventory.filename
  description = "Path to auto-generated Ansible inventory"
}

output "instance_public_ip" {
  value       = aws_instance.krypt_server.public_ip
  description = "Public IP of the Krypt server"
}
