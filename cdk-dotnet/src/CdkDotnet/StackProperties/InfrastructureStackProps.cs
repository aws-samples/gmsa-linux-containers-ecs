using Amazon.CDK;

namespace CdkDotnet.StackProperties
{
    internal class InfrastructureStackProps : NestedStackProps
    {
        public string SolutionId { get; set; }
        public string EcsInstanceKeyPairName { get; set; }
        public bool DomainJoinEcsInstances { get; set; }
    }
}
