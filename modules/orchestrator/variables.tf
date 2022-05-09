variable "cluster_tag_name" {
  description = "The tag name the Compute Instances will look for to automatically discover each other and form a cluster. TIP: If running more than one server Server cluster, each cluster should have its own unique tag name."
  type        = string
  default     = "orch"
}

variable "server_image_family" {
  type    = string
  default = "orch"
}

variable "server_cluster_name" {
  type    = string
  default = "orch-server"
}

variable "server_cluster_size" {
  type    = number
  default = 1
}

variable "server_machine_type" {
  type    = string
  default = "n1-standard-4"
}

variable "client_image_family" {
  type    = string
  default = "orch"
}

variable "client_cluster_name" {
  type    = string
  default = "orch-client"
}

variable "client_cluster_size" {
  type    = number
  default = 1
}

variable "client_machine_type" {
  type    = string
  default = "n1-standard-4"
}

variable "gcp_zone" {
  type = string
}

variable "gcp_project_id" {
  type = string
}

variable "network_name" {
  type    = string
  default = "default"
}
