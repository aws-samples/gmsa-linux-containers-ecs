using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.SSM;
using CdkDotnet.StackProperties;
using Constructs;

namespace CdkDotnet.NestedStacks
{
    internal class DatabaseStack : NestedStack
    {
        // Reference to the SQL Server RDS instance created
        public DatabaseInstance SqlServerInstance { get; set; }

        // Name of the admin user configured in the RDS SQL Server instance
        public const string SqlServerInstanceAdminUser = "web_dbo";

        public DatabaseStack(Construct scope, string id, DatabaseStackProps props = null) 
            : base(scope, id, props)
        {

            // Set up an RDS SQL Server instance with Windows auth to the Active Directory.

            // Create a SQL Server instance inside the VPC and joined to the existing directory.
            var sqlServerInstance = new DatabaseInstance(this, "web-sql-rds", 
                new DatabaseInstanceProps 
                {
                    Engine = DatabaseInstanceEngine.SqlServerWeb(new SqlServerWebInstanceEngineProps { Version = SqlServerEngineVersion.VER_15 }),
                    LicenseModel = LicenseModel.LICENSE_INCLUDED,
                    InstanceType = InstanceType.Of(InstanceClass.BURSTABLE3, InstanceSize.XLARGE),
                    Vpc = props.Vpc,
                    VpcSubnets = new SubnetSelection { SubnetType = SubnetType.PRIVATE_WITH_EGRESS },
                    Credentials = Credentials.FromGeneratedSecret(SqlServerInstanceAdminUser),
                    AutoMinorVersionUpgrade = true,
                    StorageEncrypted = true,

                    // You may wish to change these settings in a production environment.
                    DeletionProtection = false,
                    RemovalPolicy = RemovalPolicy.DESTROY
                }
            );


            // Set up credential rotation for the DB administrator user.
            sqlServerInstance.AddRotationSingleUser();

            // Store the database credentials secret ARN in the Systems Manager Parameter Store, so it can be referenced by the Web application stack.
            var sqlServerInstanceSecretArnParameter = new StringParameter(this, "sql-server-credentials-secret-arn", 
                new StringParameterProps
                {
                    AllowedPattern = ".*",
                    Description = "ARN of the secret containing the database credentials",
                    ParameterName = $"/{props.SolutionId}/web-site/sql-server-credentials-secret-arn",
                    StringValue = sqlServerInstance.Secret?.SecretArn ?? "",
                    Tier = ParameterTier.STANDARD
                }
            );

            // Create an IAM Role with the `AmazonRDSDirectoryServiceAccess` policy. This is required to join the SQL Server to the domain.
            var dbRole = new Role(this, "rds-role", 
                new RoleProps 
                {
                    AssumedBy = new ServicePrincipal("rds.amazonaws.com"),
                    ManagedPolicies = new IManagedPolicy[] { ManagedPolicy.FromAwsManagedPolicyName("service-role/AmazonRDSDirectoryServiceAccess") },
                }
            );

            // Join the SQL server to the domain. This isn't available in CDK yet, so use the CloudFormation primitives.

            // In order to join the server to the domain, we need to know the ID of the Active Directory.
            var cfnSqlServerInstance = sqlServerInstance.Node.DefaultChild as CfnDBInstance;
            cfnSqlServerInstance.Domain = props.ActiveDirectoryId;
            cfnSqlServerInstance.DomainIamRoleName = dbRole.RoleName;

            // Allow communication from then ECS ASG to the RDS SQL Server database
            sqlServerInstance.Connections.SecurityGroups[0].Connections.AllowFrom(props.EcsAsgSecurityGroup, Port.Tcp(1433));


            // Output information about the database instance.
            new CfnOutput(this, "DBInstanceIdentifier", new CfnOutputProps { Value = sqlServerInstance.InstanceIdentifier });
            new CfnOutput(this, "DBInstanceEndpointAddress", new CfnOutputProps { Value = sqlServerInstance.DbInstanceEndpointAddress });
            new CfnOutput(this, "DBInstanceCredentialsSecretARN", new CfnOutputProps { Value = sqlServerInstance.Secret?.SecretArn ?? "" });

            // Exposes the SQL Server instance for higher level constructs
            this.SqlServerInstance = sqlServerInstance;
        }
    }
}