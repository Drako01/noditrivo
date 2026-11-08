# expect: none
terraform {
  backend "s3" {
    bucket = "state"
    key = "app.tfstate"
  }
}
@@@@
terraform {
  # state lives in S3
  backend "s3" {
    bucket = "state"
    key    = "app.tfstate"
  }
}
