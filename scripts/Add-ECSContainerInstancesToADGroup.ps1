[CmdletBinding()]
param(
    [Parameter()]
    $GmsaGroupName = "",

    [Parameter(Mandatory = $true)]
    $EcsAsgName = ""
)

Write-Host "Obtaining Amazon ECS ASG information..."
$ASG = Get-ASAutoScalingGroup -AutoScalingGroupName $EcsAsgName

foreach ($actualAsgInstance in $ASG.Instances) {
    Write-Host "Obtaining information for instance $($actualAsgInstance.InstanceId)..."
    $containerInstance = $(Get-EC2Instance -InstanceId $actualAsgInstance.InstanceId).Instances

    Write-Host "Obtaining AD computer object for instance $($actualAsgInstance.InstanceId)..."
    $adComputerDnsName = $containerInstance.PrivateDnsName.Split('.')[0] #.Substring(0,15)
    $adComputer = Get-ADComputer -Filter "DnsHostName -eq ""$adComputerDnsName"""
    
    Write-Host "Adding AD computer $($adComputer.Name) to AD group $GmsaGroupName..."
    Add-ADGroupMember -Identity $GmsaGroupName -Members "$($adComputer.Name)$"
}

Write-Host "Amazon ECS instances added succesfully."