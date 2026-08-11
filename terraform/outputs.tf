output "vpc_id" {
  value       = aws_vpc.krypt_vpc.id
  description = "The ID of the generated VPC network"
}

output "instance_id" {
  value       = aws_instance.krypt_server.id
  description = "The ID of the EC2 instance running the services"
}

output "instance_public_ip" {
  value       = aws_instance.krypt_server.public_ip
  description = "Public IP address of the EC2 instance"
}
