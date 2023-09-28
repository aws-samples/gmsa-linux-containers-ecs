using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.SecretsManager;
using Amazon.CDK.AWS.SSM;

namespace CdkDotnet.StackProperties
{
    internal class ApplicationStackProps : NestedStackProps
    {
        public string SolutionId { get; set; }
        public Vpc Vpc { get; set; }
        public ISecurityGroup EcsAsgSecurityGroup { get; set; }
        public bool AreEcsInstancesDomianJoined { get; set; }
        public string DomainName { get; set; }
        public string DbInstanceName { get; set; }
        public StringParameter CredSpecParameter { get; set; }
        public Secret DomainlessIdentitySecret { get; set; }
        public string TaskDefinitionRevision { get; set; }
    }
}
