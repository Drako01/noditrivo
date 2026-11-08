# expect: terraform.variable-added-required terraform.variable-removed terraform.output-removed
variable "region" {
  default = "us-east-1"
}

variable "legacy" {
  type = string
}

output "bucket_arn" {
  value = "x"
}
@@@@
variable "region" {
  default = "us-east-1"
}

variable "environment" {
  type = string
}
