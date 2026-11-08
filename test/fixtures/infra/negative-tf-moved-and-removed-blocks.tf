# expect: none
resource "aws_s3_bucket" "old" {
  bucket = "a"
}

resource "aws_s3_bucket" "gone" {
  bucket = "b"
}

resource "aws_s3_bucket_policy" "p" {
  bucket = aws_s3_bucket.old.id
  policy = "{}"
}
@@@@
resource "aws_s3_bucket" "new" {
  bucket = "a"
}

moved {
  from = aws_s3_bucket.old
  to   = aws_s3_bucket.new
}

removed {
  from = aws_s3_bucket.gone

  lifecycle {
    destroy = false
  }
}

resource "aws_s3_bucket_policy" "p" {
  bucket = aws_s3_bucket.new.id
  policy = "{}"
}
