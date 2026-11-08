# expect: terraform.backend-changed
terraform {
  required_version = ">= 1.6"
  backend "s3" {
    bucket = "state-a"
    key    = "app.tfstate"
  }
}
@@@@
terraform {
  required_version = ">= 1.6"
  backend "s3" {
    bucket = "state-b"
    key    = "app.tfstate"
  }
}
