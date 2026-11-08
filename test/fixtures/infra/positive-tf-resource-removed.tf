# expect: terraform.resource-removed terraform.resource-removed
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}

module "network" {
  source = "./network"
}

resource "aws_s3_bucket" "keep" {
  bucket = "keep"
}
@@@@
resource "aws_s3_bucket" "keep" {
  bucket = "keep"
}
