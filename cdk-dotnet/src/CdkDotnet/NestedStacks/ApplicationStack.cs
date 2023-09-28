using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.ECS;
using Amazon.CDK.AWS.ECS.Patterns;
using Amazon.CDK.AWS.IAM;
using CdkDotnet.Models;
using CdkDotnet.StackProperties;
using Constructs;
using System;
using System.Collections.Generic;

namespace CdkDotnet.NestedStacks
{
    internal class ApplicationStack : NestedStack
    {
        public ApplicationStack(Construct scope, string id, ApplicationStackProps props = null)
            : base(scope, id, props)
        {
            // Get reference to the ECS cluster.
            var cluster = Cluster.FromClusterAttributes(this, "ecs-cluster",
                new ClusterAttributes
                {
                    ClusterName = props.SolutionId,
                    Vpc = props.Vpc,
                    SecurityGroups = new ISecurityGroup[] { }
                }
            );

            // Create an IAM role for the task execution and  allows read access to the CredSpec SSM Parameter.
            var taskExecutionRole = new Role(this, "web-site-task-execution-role",
                new RoleProps
                {
                    RoleName = $"{props.SolutionId}-web-site-task-execution-role",
                    AssumedBy = new ServicePrincipal("ecs-tasks.amazonaws.com")
                }
            );

            taskExecutionRole.AddManagedPolicy(ManagedPolicy.FromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"));
            props.CredSpecParameter.GrantRead(taskExecutionRole);
            props.DomainlessIdentitySecret.GrantRead(taskExecutionRole);

            // Create the container repository for the application
            var webSiteRepository = new Repository(this, "web-site-repository",
                new RepositoryProps
                {
                    RepositoryName = $"{props.SolutionId}/web-site"
                }
            );

            // Create a ECS task. Include an application scratch volume.
            var ec2TaskDefinition = new Ec2TaskDefinition(this, "web-site-task",
                new Ec2TaskDefinitionProps
                {
                    Family = "amazon-ecs-gmsa-linux-web-site-task",
                    ExecutionRole = taskExecutionRole,
                    Volumes = new Amazon.CDK.AWS.ECS.IVolume[]
                    {
                        new Amazon.CDK.AWS.ECS.Volume
                        {
                            Name = "application_scratch",
                            Host = new Host { }
                        }
                    }
                }
            );


            // Add the web application container to the task definition.
            var webSiteContainer = ec2TaskDefinition.AddContainer("web-site-container",
                new ContainerDefinitionOptions
                {
                    Image = ContainerImage.FromEcrRepository(webSiteRepository, "latest"),
                    MemoryLimitMiB = 512,
                    HealthCheck = new HealthCheck
                    {
                        Command = new string[]
                        {
                            "CMD-SHELL",
                            "curl -f http://localhost/Privacy || exit 1"
                        }
                    },
                    Logging = LogDrivers.AwsLogs(new AwsLogDriverProps { StreamPrefix = "web" }),
                    DockerSecurityOptions = new string[] { $"credentialspec:{props.CredSpecParameter.ParameterArn}" },
                    Environment =
                        new Dictionary<string, string>
                        {
                            { "ASPNETCORE_ENVIRONMENT", "Development"},
                            // To use Kerberos authenication, you should use a domain FQDM to refere to the SQL Server,
                            //   if you use the endpoint provided for by RDS the NTLM auth will be used instead, and will fail.
                            { "ConnectionStrings__Chinook", $"Server={props.DbInstanceName}.{props.DomainName};Database=Chinook;Integrated Security=true;TrustServerCertificate=true;" }
                        }
                }
            );

            webSiteContainer.AddPortMappings(new IPortMapping[] { new PortMapping{ ContainerPort = 80 } });
            webSiteContainer.AddMountPoints(
                new IMountPoint[] 
                { 
                    new MountPoint 
                    { 
                        SourceVolume = "application_scratch", 
                        ContainerPath = "/var/scratch", 
                        ReadOnly = true 
                    } 
                }
            );

            if (ConfigProps.DEPLOY_APP == "1")
            {
                // Create a load-balanced service.    
                var loadBalancedEcsService = new ApplicationLoadBalancedEc2Service(this, "web-site-ec2-service",
                    new ApplicationLoadBalancedEc2ServiceProps
                    {
                        Cluster = cluster,
                        TaskDefinition = ec2TaskDefinition,
                        DesiredCount = 1,
                        PublicLoadBalancer = true,
                        OpenListener = true,
                        EnableExecuteCommand = true
                    }
                );

                loadBalancedEcsService.TargetGroup.ConfigureHealthCheck(
                    new Amazon.CDK.AWS.ElasticLoadBalancingV2.HealthCheck { Path = "/Privacy" });

                // Updates the task definition revison based on the global environment variable.
                (loadBalancedEcsService.Service.Node.TryFindChild("Service") as CfnService)?.AddPropertyOverride("TaskDefinition", $"arn:aws:ecs:{this.Region}:{this.Account}:task-definition/{ec2TaskDefinition.Family}:{props.TaskDefinitionRevision}");

                // Allow communication from the ECS service's ELB to the ECS ASG
                loadBalancedEcsService.LoadBalancer.Connections.AllowTo(props.EcsAsgSecurityGroup, Port.AllTcp());
            }
            else
            {
                Console.WriteLine("DEPLOY_APP not set, skipping Amazon ECS service deployment.");
            }
        }
    }
}