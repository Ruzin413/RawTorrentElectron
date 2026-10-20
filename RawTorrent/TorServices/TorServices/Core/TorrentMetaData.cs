using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace TorServices.Core;

public class TorrentMetadata
{
    public string Name { get; set; } = string.Empty;
    public int PieceLength { get; set; }
    public byte[] Pieces { get; set; } = Array.Empty<byte>();
    public List<FileMetadata> Files { get; set; } = new();
    public long TotalLength { get; set; }

    public TorrentMetadata(Dictionary<string, object> info)
    {
        Name = Encoding.UTF8.GetString((byte[])info["name"]);
        PieceLength = IntHelper.ToInt(info["piece length"]);
        Pieces = (byte[])info["pieces"];

        if (info.ContainsKey("length"))
        {
            // Single file mode
            long length = IntHelper.ToLong(info["length"]);
            Files.Add(new FileMetadata 
            { 
                Path = CleanupPath(Name), 
                Length = length, 
                Offset = 0 
            });
            TotalLength = length;
        }
        else if (info.ContainsKey("files"))
        {
            // Multi file mode
            var files = (List<object>)info["files"];
            long currentOffset = 0;
            foreach (var f in files)
            {
                var dict = (Dictionary<string, object>)f;
                var length = IntHelper.ToLong(dict["length"]);
                var pathList = (List<object>)dict["path"];
                
                var pathParts = pathList.Select(p => CleanupPath(Encoding.UTF8.GetString((byte[])p))).ToArray();
                string relativePath = Path.Combine(pathParts);
                
                // Root folder + relative path
                string fullPath = Path.Combine(CleanupPath(Name), relativePath);

                Files.Add(new FileMetadata 
                { 
                    Path = fullPath, 
                    Length = length, 
                    Offset = currentOffset 
                });
                currentOffset += length;
            }
            TotalLength = currentOffset;
        }
    }

    // Fixed (Windows) invalid set so behaviour is identical on every OS.
    private static readonly char[] InvalidNameChars =
        "<>:\"/\\|?*".Concat(Enumerable.Range(0, 32).Select(i => (char)i)).ToArray();

    /// <summary>
    /// Sanitizes a single path segment from torrent metadata so it can't contain
    /// separators or be "." / ".." (which would escape the output directory).
    /// </summary>
    public static string CleanupPath(string path)
    {
        foreach (char c in InvalidNameChars)
        {
            path = path.Replace(c, '_');
        }
        if (string.IsNullOrWhiteSpace(path) || path.Trim().Trim('.').Length == 0)
        {
            path = "_";
        }
        return path;
    }

    public void Rename(string newName)
    {
        string oldRoot = CleanupPath(Name);
        string newRoot = CleanupPath(newName);
        Name = newName;

        foreach (var file in Files)
        {
            if (file.Path.StartsWith(oldRoot))
            {
                file.Path = Path.Combine(newRoot, file.Path.Substring(oldRoot.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            }
        }
    }
}

public static class IntHelper
{
    public static int ToInt(object value)
    {
        if (value is int i) return i;
        if (value is long l) return (int)l;
        return Convert.ToInt32(value);
    }

    public static long ToLong(object value)
    {
        if (value is long l) return l;
        if (value is int i) return (long)i;
        return Convert.ToInt64(value);
    }
}