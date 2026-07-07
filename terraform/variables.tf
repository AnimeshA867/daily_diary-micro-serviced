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

variable "db_username" {
  type        = string
  default     = "postgres"
  description = "Database administrator username"
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "Database administrator password"
}
