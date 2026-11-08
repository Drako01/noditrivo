resource "aws_s3_bucket" "order_exports" {
  bucket = "orders-exports"
}

resource "aws_s3_bucket_policy" "exports" {
  bucket = aws_s3_bucket.exports.id
  policy = "{}"
}
