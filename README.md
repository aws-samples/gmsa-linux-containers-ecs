## AWS Blog: Using Windows Authentication with gMSA on Linux Containers on Amazon ECS

This repository contains sample code for the AWS Blog Post [Using Windows Authentication with gMSA on Linux Containers on Amazon ECS](https://aws.amazon.com/blogs/containers/using-windows-authentication-with-gmsa-on-linux-containers-on-amazon-ecs/). 

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

## Domainless and domain-joined modes

There are two modes in which you can support Windows authentication using gMSA for your applications, non-domain-joined (domainless) mode and domain-joined mode. 

**In domainless mode**, the Amazon ECS container instances doesn’t need to be joined to the target AD domain. This is the recommended mode for most workloads, especially when scaling is needed.

**In domain-joined mode**, you to have the Amazon ECS container instances joined to the target AD domain prior to deploying tasks on them. Use this mode if you don’t want to manage individual AD user accounts.

## Deploy the Infrastructure

1. Clone this repository and open the terminal and run the following commands, replace `{KEY_PAIR_NAME}` with your Amazon EC2 key pair name, and run the following commands: 
    * **If you are using Bash**:
        ``` bash
        export AWS_DEFAULT_REGION={YOUR REGION}
        export EC2_INSTANCE_KEYPAIR_NAME="{KEY_PAIR_NAME}"
        export MY_SG_INGRESS_IP=$(curl checkip.amazonaws.com)
        export DOMAIN_JOIN_ECS=0
        ```
    * **If you’re using PowerShell**:
        ```powershell
        $Env:AWS_DEFAULT_REGION = "{YOUR REGION}"
        $Env:EC2_INSTANCE_KEYPAIR_NAME = "{KEY_PAIR_NAME}"
        $Env:MY_SG_INGRESS_IP = $(Invoke-WebRequest -URI https://checkip.amazonaws.com).ToString().Trim()
        $Env:DOMAIN_JOIN_ECS = 0   
        ```

3. Based on your laguage poreference, perform one of the following tasks:
    * **For typescript:** Open a terminal and in the **cdk-typescript** folder and execute the following command:
      ``` bash
      npm install
      ```
    * **For C#:** Open a terminal and in the **cdk-dotnet** folder and execute the following command:
      ``` bash
      dotnet build src
      ```
4. Execute deploy command for cdk project:
    ``` bash
    cdk deploy "*" --require-approval "never"
    ```


> **Note:** To use domain-joined mode, set the `DOMAIN_JOIN_ECS` variable to `1` before deploying the AWS CDK solution.

> **Note:** In domain-joined mode, you need to add the Computer principal to the AD security group allowed to retrieve gMSA passwords. You can do this manually or via automation. The script inside the AD management instance on `C:\SampleConfig\Add-ECSContainerInstancesToADGroup.ps1` inside the AD management instance, automatically adds all Amazon ECS container instance's principals to the AD security group. You need to pass as argument the name of the Amazon ECS’s ASG, which you will find in the **ECSAutoScalingGroupName** output of the **amazon-ecs-gmsa-linux-infrastructure** CloudFormation stack.

3. Navigate to the AWS Secrets Manager console and copy the value of the **amazon-ecs-gmsa-linux/active-directory-administrator-password** secret. 

This will start the deployment of three AWS CloudFormation stacks that contain the sample solution. **The deployment takes around one hour to complete.**
## Create the Credential Specification

1. Navigate to the Amazon EC2 console, then select the instance named **amazon-ecs-gmsa-linux-bastion/active-directory-management-instance** and [connect to it using RDP](https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/connecting_to_windows_instance.html#connect-rdp) using the following:
   * **Username**: `directory.amazon-ecs-gmsa-linux.com\admin`
   * **Password**: Use the one you retrieved from Secrets Manager.

> If you can’t log in, the instance is still setting up the database and Active Directory. Wait 10-15 minutes and try again.

2. In the Remote Desktop session, open a PowerShell window and run `C:\SampleConfig\Generate-CredSpec.ps1`

> **Note:** In domain-joined mode, append the following parameter while running the script: `-DomainlessArn ""`.

## Build the .NET application container

1. Open a terminal in the **web-app** folder and build the solution running `dotnet build web-app.sln`

2. Build the Docker container running `docker build .`

3. Navigate to the Amazon ECR console,select the **amazon-ecs-gmsa-linux/web-site** repository, then select **View push commands**. 

4. Follow the directions to tag and push your image to the ECR repository. 

> If you are building the container in a computer with an ARM processor like a M1/M2 Mac, to build a x86-64 container use: `docker buildx build --platform=linux/amd64 -t amazon-ecs-gmsa-linux/web-site .`

![Amazon ECR view push commands dialog](/docs/images/ecr_push_commands.jpg)

## Configure the Amazon ECS task definition
You need to update the ECS Task definition created by CDK to set the ARN for the CredSpec file using the new `credentialSpec` property. This property can only be set using the AWS CLI. The sample solution has a script that does this for you. Using the same terminal where you deployed the CDK solution, run the following command if you are using Bash:

``` bash
../scripts/update-ecs-task-definition-cred-spec.sh -t amazon-ecs-gmsa-linux-web-site-task
```

Or the following command if you are using PowerShell:

```powershell
../scripts/Update-ECSTaskDefinitionCredSpec.ps1 -TaskDefinitionName amazon-ecs-gmsa-linux-web-site-task 
```

> **Note:** In domain-joined mode, set the `--domain-joined-mode` (`-DomainJoinedMode` in PowerShell) flag when running the script.

Review the output of the script and take note of the revision number that was just created. You will use it in the next step.

## Deploy the application to Amazon ECS

1. Go back to the terminal you used to deploy the infrastructure and run the following commands:
    * If you are using Bash:
        ``` bash
        export DEPLOY_APP=1
        export APP_TD_REVISION=[TASK DEFINITION REVISION]

        cdk deploy "*" --require-approval "never"
        ```

    * If you are using PowerShell:
        ``` powershell
        $Env:DEPLOY_APP = 1
        $Env:APP_TD_REVISION = [TASK DEFINITION REVISION]

        cdk deploy "*" --require-approval "never"
        ```

2. Once the deployment is complete, go to the CloudFormation console and click on the value of the output named like **websiteec2serviceServiceURLXXXXXXXX** to navigate to the web app. The web application will run and authenticate to the AD using the gMSA.

![Sample Web App working](/docs/images/web_app.jpg)

## Cleanup

1. Run this command in the terminal or PowerShell window::

    ``` bash
    cdk destroy "*" --require-approval "never"
    ```

2. Manually delete the manually created revision for the **amazon-ecs-gmsa-linux-web-site-task** Amazon ECS task definition, the **amazon-ecs-gmsa-linux/web-site** Amazon ECR repository, and the **amazon-ecs-gmsa-linux-infrastructure-vpcFlowLogCloudWatchLogGroupXXXXXXX-XXXXXXXXXXXX** Amazon CloudWatch log group .

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.




