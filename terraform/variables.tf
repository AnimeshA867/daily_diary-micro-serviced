variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "The target AWS Region for resource creation"
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Application deployment tier (e.g. dev, staging, production)"
}

variable "instance_type" {
  type        = string
  default     = "t3.large"
  description = "EC2 instance type for running docker-compose"
}

variable "ami_id" {
  type        = string
  default     = "ami-0c55b159cbfafe1f0"
  description = "AMI ID for the EC2 instance"
}

variable "ssh_public_key" {
  type        = string
  default     = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQC... dummykey"
  description = "Public SSH key for EC2 instance"
}

variable "ssh_key_path" {
  description = "Path to SSH private key for Ansible"
  type        = string
  default     = "~/.ssh/krypt_aws.pem"
}

variable "ansible_user" {
  description = "Ansible user (typically ubuntu or ec2-user)"
  type        = string
  default     = "ubuntu"
}
