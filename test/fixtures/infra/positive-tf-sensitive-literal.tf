# expect: terraform.sensitive-literal terraform.sensitive-literal
resource "aws_db_instance" "main" {
  identifier = "main"
  password   = "hunter2"
}

variable "api_token" {
  default = "abc123"
}
