## AWS Blog: Using Windows Authentication with gMSA on Linux Containers on Amazon ECS

This repository contains sample code for the AWS Blog Post "Using Windows Authentication with gMSA on Linux Containers on Amazon ECS". 

![Sample solution architecture diagram](/docs/images/architecture.jpg)

## Pre-requisites

Before running this sample, you will need:

* An [AWS account](https://aws.amazon.com/).
* Complete the [AWS CDK getting started guide](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html), including installing the CDK and learning the key concepts.
* Create an [Amazon EC2 key pair](https://docs.aws.amazon.com/cli/latest/userguide/cli-services-ec2-keypairs.html) and record its name.
* [Install the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) and set up your [AWS credentials for command-line use](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html#getting_started_prerequisites) if you are using a Bash-compatible shell.
  * If you prefer to use PowerShell, install the [AWS Tools for PowerShell](https://aws.amazon.com/powershell/) and set up your [AWS credentials for PowerShell](https://docs.aws.amazon.com/powershell/latest/userguide/specifying-your-aws-credentials.html).
* Install a [Microsoft Remote Desktop (RDP) client](https://docs.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/remote-desktop-clients).
* Install the latest version of the [Docker runtime](https://docs.docker.com/engine/install/).
* Install the [latest .NET 6 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/6.0).


## Deploy the Infrastructure

1. Clone the repo and open a terminal and in the `cdk` folder.

2. Open a terminal in the `cdk` directory of the cloned repository, replace `{KEY_PAIR_NAME}` with your Amazon EC2 key pair name, and run the following commands if you are using Bash.


``` bash
export EC2_INSTANCE_KEYPAIR_NAME="{Your Key Pair}"
export MY_SG_INGRESS_IP=$(curl https://checkip.amazonaws.com)
export DOMAIN_JOIN_ECS=1

cdk deploy "*" --require-approval "never"
```

If you’re using PowerShell, run the following commands:

```powershell
$Env:EC2_INSTANCE_KEYPAIR_NAME = "{KEY_PAIR_NAME}"
$Env:MY_SG_INGRESS_IP = $(Invoke-WebRequest -URI https://checkip.amazonaws.com).ToString().Trim()
$Env:DOMAIN_JOIN_ECS=1

cdk deploy "*" --require-approval "never"
```

> If you set the environment variable `DOMAIN_JOIN_ECS=0`, you will use Credential Fetchers in scalability-mode. The solution will not deploy the Systems Manager association to join the Amazon ECS container instances to the AD domain, and will set the `CREDENTIALS_FETCHER_SECRET_NAME_FOR_DOMAINLESS_GMSA` environment variable in the Amazon ECS ASG. This is will tell Credentials Fetcher to use the credentials stored in that AWS Secrest Manager secret to authenticate to the AD instead of using the Computer principal. The main benefit for this is that there is no need to add the Computer principal to the AD security group anymore.

> When using Credentials Fetcher in domain-joined mode, you need to add the Computer principal to the AD security group allowed to retrieve gMSA passwords. You can do this manually or via automation. The script inside the AD management instance on `C:\SampleConfig\Add-ECSContainerInstancesToADGroup.ps1` inside the AD management instance,  automatically adds all Amazon ECS container instance's principals to the AD security group. You need to pass as argument the name of the Amazon ECS’s ASG, which you will find in the **ECSAutoScalingGroupName** output of the **amazon-ecs-gmsa-linux-infrastructure** CloudFormation stack..

3. Navigate to the AWS Secrets Manager console and copy the value of the `amazon-ecs-gmsa-linux/active-directory-administrator-password` secret. 

This will start the deployment of three AWS CloudFormation stacks that contain the sample solution. **The deployment takes around one hour to complete.**
## Create the Credential Specification

1. Navigate to the Amazon EC2 console, then select the instance named `amazon-ecs-gmsa-linux-bastion/active-directory-management-instance` and [connect to it using RDP](https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/connecting_to_windows_instance.html#connect-rdp) using the follwing:
   * **Username**: `directory.amazon-ecs-gmsa-linux.com\admin`
   * **Password**: Use the one you retrieved from Secrets Manager.

> If you can’t log in, the instance is still setting up the database and Active Directory. Wait 10-15 minutes and try again.

2. In the Remote Desktop session, open a PowerShell window and run `C:\SampleConfig\Generate-CredSpec.ps1`

## Build the .NET application container

1. Open a terminal in the `web-app` folder and build the solution running `dotnet build web-app.sln`

2. Build the Docker container running `docker build .`

3. Navigate to the Amazon ECR console,select the `amazon-ecs-gmsa-linux/web-site` repository, then select **View push commands**. 

4. Follow the directions to tag and push your image to the ECR repository. 

> If you are building the container in a computer with an ARM processor like a M1/M2 Mac, to build a x86-64 container use: `docker buildx build --platform=linux/amd64 -t amazon-ecs-gmsa-linux/web-site .`

![Amazon ECR view push commands dialog](/docs/images/ecr_push_commands.jpg)
## Deploy the application to Amazon ECS

1. Go back to the terminal you used to deploy the infrastructure and run the following commands if you are using Bash:

``` bash
export DEPLOY_APP=1

cdk deploy "*" --require-approval "never"
```

Run the following commands if you are using PowerShell:

``` powershell
$Env:DEPLOY_APP = 1

cdk deploy "*" --require-approval "never"
```

2. Once the deployment completes, look for the CDK Output named like `amazon-ecs-gmsa-linux-application.websiteec2serviceServiceURLXXXXXXXX` and copy its value. Wait for a few minutes for the container to start, then navigate to this URL. The Web application will run authenticated to the Active Directory using the gMSA.

![Sample Web App working](/docs/images/web_app.jpg)

## Cleanup

1. Run this command in the terminal or PowerShell window::

``` bash
cdk destroy "*" --require-approval "never"
```

2. Manually delete the Amazon ECR repository names `amazon-ecs-gmsa-linux/web-site` and Amazon CloudWatch log group `amazon-ecs-gmsa-linux-infrastructure-vpcFlowLogCloudWatchLogGroupXXXXXXX-XXXXXXXXXXXX`.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

