using Kerberos.NET.Client;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Data.SqlClient;

namespace web_app.Pages;

public class IndexModel : PageModel
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<IndexModel> _logger;

    public List<Album> Albums { get; set; }
    public SQLConnectionInformation ConnectionInfo { get; set; }

    public IndexModel(IConfiguration configuration, ILogger<IndexModel> logger)
    {
        _configuration = configuration;
        _logger = logger;
        this.Albums = new List<Album>();
        this.ConnectionInfo = new SQLConnectionInformation();
    }

    public void OnGet()
    {
        Console.WriteLine("Home page requested");

        this.Albums = GetAlbumsFromDB();
        this.ConnectionInfo = GetConnectionInformation();        
    }

    private List<Album> GetAlbumsFromDB()
    {
        var result = new List<Album>();

        try
        {
            var connectionString = _configuration.GetConnectionString("Chinook");
            Console.WriteLine($"Connecting to {connectionString}");
            
            using (var connection = new SqlConnection(connectionString))
            {
                var command = new SqlCommand($"SELECT TOP 5 * FROM dbo.Album ORDER BY NEWID()", connection);
                Console.WriteLine($"Executing {command.CommandText}");
                connection.Open();

                using (var reader = command.ExecuteReader())
                {
                    Console.WriteLine("Reading results...");
                    while (reader.Read())
                    {
                        result.Add(new Album{
                            AlbumId = reader.GetInt32(0),
                            Title = reader.GetString(1)
                        });
                    }
                }
            }

            Console.WriteLine("Chinook database queried successfully.");
        }
        catch (SqlException ex)
        {
            Console.WriteLine("Error querying the Chinook database.");
            Console.WriteLine(ex.Message);
        }

        return result;
    }

    private SQLConnectionInformation GetConnectionInformation()
    {
        var result = new SQLConnectionInformation();
        result.ConnectionString = _configuration.GetConnectionString("Chinook");
        Console.WriteLine($"Connecting to {result.ConnectionString}");

        try
        {
            using (var connection = new SqlConnection(result.ConnectionString))
            {
                using (var command = new SqlCommand("SELECT system_user, auth_scheme FROM sys.dm_exec_connections WHERE session_id=@@spid;", connection))
                {
                    Console.WriteLine($"Executing {command.CommandText}");
                    connection.Open();
                    using (var reader = command.ExecuteReader())
                    {
                        Console.WriteLine("Reading results...");
                        while (reader.Read())
                        {
                            result.SQLUser = reader.GetString(0);
                            result.SQLAuthentication = reader.GetString(1);
                        }
                    }
                }
            }

            Console.WriteLine("SQL connection information queried successfully.");
        }
        catch (SqlException ex)
        {
            Console.WriteLine("Error querying the connection information.");
            Console.WriteLine(ex.Message);
        }

        return result;
    }
}

public class Album
{
    public int AlbumId { get; set; }

    public string Title { get; set; }
}

public class SQLConnectionInformation
{
    public string ConnectionString { get; set; }
    public string SQLUser { get; set; }
    public string SQLAuthentication { get; set; }

}