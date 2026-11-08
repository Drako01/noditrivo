# expect: none
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}
@@@@
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
  tags = {
    team = "platform"
  }
}

resource "aws_s3_bucket" "extra" {
  bucket = "extra"
}

variable "region" {
  default = "us-east-1"
}

variable "zone" {
  type = string
  default = null
}

output "bucket" {
  value = aws_s3_bucket.logs.id
}
