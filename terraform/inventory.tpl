[krypt_servers]
krypt-server ansible_host=${instance_ip} ansible_user=${ansible_user} ansible_private_key_file=${ssh_key_path}

[krypt_servers:vars]
ansible_python_interpreter=/usr/bin/python3