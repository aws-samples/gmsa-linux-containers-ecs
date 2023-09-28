using System;
using System.Data;

namespace CdkDotnet.Models
{
    public static class ConfigProps
    {
        public static string SOLUTION_ID;
        public static string EC2_INSTANCE_KEYPAIR_NAME;
        public static string MY_SG_INGRESS_IP;
        public static string DEPLOY_APP;
        public static string DOMAIN_JOIN_ECS;
        public static string APP_TD_REVISION;

        static ConfigProps()
        {
            if (null == Environment.GetEnvironmentVariable("EC2_INSTANCE_KEYPAIR_NAME"))
            {
                Console.WriteLine("EC2_INSTANCE_KEYPAIR_NAME environment variable not assigned.");
                throw new NoNullAllowedException("An EC2 Key pair for the AD Management instance is required to create the shared infrastructure.");
            }

            if (null == Environment.GetEnvironmentVariable("MY_SG_INGRESS_IP"))
            {
                Console.WriteLine("MY_SG_INGRESS_IP environment variable not assigned.");
                Console.WriteLine("Run the following command and try again.\n  On Linux: `export MY_SG_INGRESS_IP=$(curl checkip.amazonaws.com)`\n  On Windows Powershell run `$env:MY_SG_INGRESS_IP = $(Invoke-WebRequest \"checkip.amazonaws.com\")`");
                throw new NoNullAllowedException("The IP to access the AD Management instance is required to create the shared infrastructure.");

            }

            SOLUTION_ID = Environment.GetEnvironmentVariable("SOLUTION_ID") ?? "amazon-ecs-gmsa-linux";
            EC2_INSTANCE_KEYPAIR_NAME = Environment.GetEnvironmentVariable("EC2_INSTANCE_KEYPAIR_NAME");
            MY_SG_INGRESS_IP = Environment.GetEnvironmentVariable("MY_SG_INGRESS_IP");
            DOMAIN_JOIN_ECS = Environment.GetEnvironmentVariable("DOMAIN_JOIN_ECS") ?? "0";
            DEPLOY_APP = Environment.GetEnvironmentVariable("DEPLOY_APP") ?? "0";
            APP_TD_REVISION = Environment.GetEnvironmentVariable("APP_TD_REVISION") ?? "2";
        }
    }
}
