output "vpc_id" {
  value       = aws_vpc.krypt_vpc.id
  description = "The ID of the generated VPC network"
}

# output "eks_endpoint" {
#   value       = aws_eks_cluster.krypt_cluster.endpoint
#   description = "Kubernetes API endpoint for the EKS Cluster control plane"
# }

# output "rds_endpoint" {
#   value       = aws_db_instance.postgres.endpoint
#   description = "PostgreSQL connection string endpoint"
# }
