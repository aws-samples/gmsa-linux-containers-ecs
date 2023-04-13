USE [master]
GO

-- Create AD admin SQL Login
IF NOT EXISTS 
    (SELECT name  
     FROM sys.server_principals
     WHERE name = 'ad\admin')
BEGIN
    CREATE LOGIN [ad\admin] FROM WINDOWS WITH DEFAULT_DATABASE = [Chinook]

    -- These permisions and roles are set to make the ad admin user equal to the RDS admin user
    GRANT ALTER ANY CONNECTION TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER ANY CREDENTIAL TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER ANY EVENT SESSION TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER ANY LOGIN TO [ad\admin] WITH GRANT OPTION
    GRANT ALTER ANY SERVER AUDIT TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER ANY SERVER ROLE TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER SERVER STATE TO [ad\admin] WITH GRANT OPTION 
    GRANT ALTER TRACE TO [ad\admin] WITH GRANT OPTION 
    GRANT CREATE ANY DATABASE TO [ad\admin] WITH GRANT OPTION 
    GRANT VIEW ANY DATABASE TO [ad\admin] WITH GRANT OPTION 
    GRANT VIEW ANY DEFINITION TO [ad\admin] WITH GRANT OPTION 
    GRANT VIEW SERVER STATE TO [ad\admin] WITH GRANT OPTION 
    ALTER SERVER ROLE [processadmin] ADD MEMBER [ad\admin]
    ALTER SERVER ROLE [setupadmin] ADD MEMBER [ad\admin] 

    PRINT 'AD user login created'
END

-- Create gMSA SQL Login
IF NOT EXISTS 
    (SELECT name  
     FROM sys.server_principals
     WHERE name = 'ad\gmsa$')
BEGIN
    CREATE LOGIN [ad\gmsa$] FROM WINDOWS WITH DEFAULT_DATABASE = [Chinook]    

    -- This is necesary for querying sys.dm_exec_connections
    GRANT VIEW SERVER STATE TO [ad\gmsa$]
    
    PRINT 'AD gMSA login created'
END
GO

USE [Chinook]
GO

-- Create AD admin DB user
IF NOT EXISTS 
    (SELECT name  
     FROM sys.database_principals
     WHERE name = 'ad\admin')
BEGIN
    CREATE USER [ad\admin] FOR LOGIN [ad\admin] WITH DEFAULT_SCHEMA=[dbo]
    PRINT 'AD user DB user created'    
END
GO
EXEC sp_addrolemember N'db_owner', N'ad\admin'
GO

-- Create gMSA DB user
IF NOT EXISTS 
    (SELECT name  
     FROM sys.database_principals
     WHERE name = 'ad\gmsa$')
BEGIN
    CREATE USER [ad\gmsa$] FOR LOGIN [ad\gmsa$] WITH DEFAULT_SCHEMA=[dbo]
    PRINT 'AD gMSA DB user created'
END
GO
EXEC sp_addrolemember N'db_owner', N'ad\gmsa$'
GO