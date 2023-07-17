
if (!process.env.EC2_INSTANCE_KEYPAIR_NAME) {
    console.log('EC2_INSTANCE_KEYPAIR_NAME environment variable not assigned.');
}

if (!process.env.MY_SG_INGRESS_IP) {
    console.log('MY_SG_INGRESS_IP environment variable not assigned.');
    console.log('Run the following command and try again.\n  On Linux: `export MY_SG_INGRESS_IP=$(curl checkip.amazonaws.com)`\n  On Windows Powershell run `$env:MY_SG_INGRESS_IP = $(Invoke-WebRequest "checkip.amazonaws.com")`')
}

export const props = {    
    SOLUTION_ID: 'amazon-ecs-gmsa-linux' || process.env.SOLUTION_ID,
    EC2_INSTANCE_KEYPAIR_NAME: process.env.EC2_INSTANCE_KEYPAIR_NAME,
    MY_SG_INGRESS_IP: process.env.MY_SG_INGRESS_IP,    
    DOMAIN_JOIN_ECS: process.env.DOMAIN_JOIN_ECS || '0',
    DEPLOY_APP: process.env.DEPLOY_APP || '0',
    APP_TD_REVISION: process.env.APP_TD_REVISION || '2',
}