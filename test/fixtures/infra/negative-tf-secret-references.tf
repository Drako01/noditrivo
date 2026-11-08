# expect: none
variable "db_password" {
  type      = string
  sensitive = true
}

resource "aws_db_instance" "main" {
  identifier         = "main"
  password           = var.db_password
  password_length    = "16"
  secret_arn         = "arn:aws:secretsmanager:us-east-1:111111111111:secret:x"
  master_user_secret = "${var.db_password}"
}
