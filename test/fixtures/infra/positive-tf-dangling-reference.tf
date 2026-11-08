# expect: terraform.resource-removed terraform.dangling-reference
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = "{}"
}
@@@@
resource "aws_s3_bucket" "audit" {
  bucket = "logs"
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = "{}"
}
