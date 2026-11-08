# expect: none
# resource "aws_s3_bucket" "commented" {
resource "aws_instance" "web" {
  user_data = <<-EOT
    resource "aws_s3_bucket" "inside_heredoc" {
    variable "fake" {}
  EOT
  tags = {
    note = "resource \"aws_s3_bucket\" \"in_string\" { } ${var.region}"
  }
}

variable "region" {
  default = "us-east-1"
}
@@@@
resource "aws_instance" "web" {
  tags = {
    note = "changed"
  }
}

variable "region" {
  default = "us-east-1"
}
