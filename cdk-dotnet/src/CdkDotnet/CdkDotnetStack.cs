using Amazon.CDK;
using Constructs;
using CdkDotnet.NestedStacks;
using CdkDotnet.Models;
using CdkDotnet.StackProperties;
using System;
namespace CdkDotnet
{
    public class CdkDotnetStack : Stack
    {
        internal CdkDotnetStack(Construct scope, string id, IStackProps props = null)
            : base(scope, id, props)
        {
            // Create shared infrastructure
            var infraStack = new InfrastructureStack(this, $"infrastructure",
                new InfrastructureStackProps
                {
                    SolutionId = ConfigProps.SOLUTION_ID,
                    EcsInstanceKeyPairName = ConfigProps.EC2_INSTANCE_KEYPAIR_NAME,
                    DomainJoinEcsInstances = ConfigProps.DOMAIN_JOIN_ECS == "1"
                }
            );

            // Create the SQL Server RDS instance 
            var dbStack = new DatabaseStack(this, $"database",
                new DatabaseStackProps
                {
                    SolutionId = ConfigProps.SOLUTION_ID,
                    Vpc = infraStack.Vpc,
                    ActiveDirectoryId = infraStack.ActiveDirectory.AttrAlias,
                    EcsAsgSecurityGroup = infraStack.EcsAsgSecurityGroup
                }
            );

            //Create Bastion Host / AD Admin Instance
            var bastionStack = new BastionHostStack(this, $"bastion",
                new BastionHostStackProps
                {
                    SolutionId = ConfigProps.SOLUTION_ID,
                    Vpc = infraStack.Vpc,
                    AdInfo = infraStack.AdInfo,
                    AdManagementInstanceKeyPairName = ConfigProps.EC2_INSTANCE_KEYPAIR_NAME,
                    AdManagementInstanceAccessIp = ConfigProps.MY_SG_INGRESS_IP,
                    ActiveDirectory = infraStack.ActiveDirectory,
                    ActiveDirectoryAdminPasswordSecret = infraStack.ActiveDirectoryAdminPasswordSecret,
                    DomiainJoinSsmDocument = infraStack.DomiainJoinSsmDocument,
                    DomainJoinTag = infraStack.AdDomainJoinTagKey,
                    SqlServerRdsInstance = dbStack.SqlServerInstance,
                    CredSpecParameter = infraStack.CredSpecParameter,
                    DomainlessIdentitySecret = infraStack.DomainlessIdentitySecret
                }
            );

            if (ConfigProps.DEPLOY_APP == "1")
            {
                Console.WriteLine($"Revision \"{ConfigProps.APP_TD_REVISION}\" of the Amazon ECS task definition is been used in the Amazon ECS service.If you want a different revision, set the APP_TD_REVISION environment variable to a different value.");
            }
            
            new ApplicationStack(this, $"application",
                new ApplicationStackProps
                {
                    SolutionId = ConfigProps.SOLUTION_ID,
                    Vpc = infraStack.Vpc,
                    EcsAsgSecurityGroup = infraStack.EcsAsgSecurityGroup,
                    AreEcsInstancesDomianJoined = ConfigProps.DOMAIN_JOIN_ECS == "1",
                    DomainName = infraStack.ActiveDirectory.Name,
                    DbInstanceName = dbStack.SqlServerInstance.InstanceIdentifier,
                    CredSpecParameter = infraStack.CredSpecParameter,
                    DomainlessIdentitySecret = infraStack.DomainlessIdentitySecret,
                    TaskDefinitionRevision = ConfigProps.APP_TD_REVISION
                }
            );
        }
    }
}

