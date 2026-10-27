using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace EmiliaInstaller {
 public static class Native {
  public const string ProductId="EmiliaEnglishCoach";
  public const string RetainedDataMarker=".emilia-user-data.json";
  public static string Quote(string value) {
   StringBuilder result=new StringBuilder("\"");int slashes=0;
   foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
   result.Append('\\',slashes*2);return result.Append('"').ToString();
  }
  public static Dictionary<string,object> ReadJson(string file){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));}
  public static void WriteJson(string file,object value){Directory.CreateDirectory(Path.GetDirectoryName(file));AtomicWrite(file,Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value)));}
  public static string Hash(string file){using(FileStream stream=File.OpenRead(file))using(SHA256 hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
  public static void AtomicWrite(string file,byte[] bytes){
   CheckAncestors(file);string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
   try{File.WriteAllBytes(temp,bytes);if(File.Exists(file))File.Delete(file);File.Move(temp,file);}finally{if(File.Exists(temp))File.Delete(temp);}
  }
  public static void CheckAncestors(string file){
   string current=Path.GetFullPath(file);
   while(!String.IsNullOrEmpty(current)){
    if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("不支持链接或重定向目录："+current);
    string parent=Path.GetDirectoryName(current);if(parent==current)break;current=parent;
   }
  }
  public static string ValidateInstallRoot(string raw,bool allowNew){
   if(String.IsNullOrWhiteSpace(raw))throw new IOException("请选择安装目录。");
   string root=Path.GetFullPath(raw).TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar);
   string drive=Path.GetPathRoot(root).TrimEnd('\\','/');
   if(root.Equals(drive,StringComparison.OrdinalIgnoreCase)||root.StartsWith("\\\\"))throw new IOException("请选择本机独立文件夹。");
   foreach(Environment.SpecialFolder item in new Environment.SpecialFolder[]{Environment.SpecialFolder.UserProfile,Environment.SpecialFolder.Desktop,Environment.SpecialFolder.MyDocuments,Environment.SpecialFolder.Windows,Environment.SpecialFolder.ProgramFiles,Environment.SpecialFolder.LocalApplicationData}){
    string special=Environment.GetFolderPath(item).TrimEnd('\\','/');if(special.Length>0&&root.Equals(special,StringComparison.OrdinalIgnoreCase))throw new IOException("请使用该目录内的独立应用文件夹。");
   }
   CheckAncestors(root);
   string ready=Path.Combine(root,".emilia-install.json"),pending=Path.Combine(root,".emilia-installing.json"),retained=Path.Combine(root,RetainedDataMarker);
   if(File.Exists(ready)||File.Exists(pending)||File.Exists(retained)){
    string markerFile=File.Exists(ready)?ready:File.Exists(pending)?pending:retained;
    Dictionary<string,object> marker=ReadJson(markerFile);object product;
    if(!marker.TryGetValue("product",out product)||Convert.ToString(product)!=ProductId)throw new IOException("目标目录不属于 Emilia。");
    if(markerFile==retained){
     CheckAncestors(retained);string data=Path.Combine(root,"user-data");CheckAncestors(data);
     if(!Directory.Exists(data))throw new IOException("保留的 Emilia 用户数据目录缺失。");
     foreach(string entry in Directory.GetFileSystemEntries(root)){
      string name=Path.GetFileName(entry);
      if(!name.Equals("user-data",StringComparison.OrdinalIgnoreCase)&&!name.Equals(RetainedDataMarker,StringComparison.OrdinalIgnoreCase))throw new IOException("请选择空文件夹，或已有的 Emilia 安装目录。");
     }
    }
   }else if(!allowNew||(Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length>0))throw new IOException("请选择空文件夹，或已有的 Emilia 安装目录。");
   return root;
  }
  static string Destination(string root,string relative){
   if(String.IsNullOrEmpty(relative)||Path.IsPathRooted(relative))throw new IOException("安装包路径无效。");
   string[] parts=relative.Replace('\\','/').Split('/');
   foreach(string part in parts){
    if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(Path.GetInvalidFileNameChars())>=0)throw new IOException("安装包包含不安全的路径。");
    string baseName=part.Split('.')[0].ToUpperInvariant();if(baseName=="CON"||baseName=="PRN"||baseName=="AUX"||baseName=="NUL"||System.Text.RegularExpressions.Regex.IsMatch(baseName,"^(COM|LPT)[1-9]$"))throw new IOException("安装包包含保留文件名。");
   }
   string folder=Path.GetFullPath(root).TrimEnd('\\','/')+Path.DirectorySeparatorChar;
   string file=Path.GetFullPath(Path.Combine(folder,Path.Combine(parts)));
   if(!file.StartsWith(folder,StringComparison.OrdinalIgnoreCase))throw new IOException("安装包路径超出目标目录。");CheckAncestors(file);return file;
  }
  public static void ExtractZip(string archive,string root,string prefix){Extract(archive,root,prefix,false);}
  public static void ExtractWheel(string archive,string pythonRoot){Extract(archive,pythonRoot,null,true);}
  static void Extract(string archive,string root,string prefix,bool wheel){
   CheckAncestors(root);Directory.CreateDirectory(root);
   HashSet<string> seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
   using(ZipArchive zip=ZipFile.OpenRead(archive)){
    if(zip.Entries.Count>100000)throw new IOException("压缩包文件数量超限。");
    foreach(ZipArchiveEntry entry in zip.Entries){
     if(((entry.ExternalAttributes>>16)&0xf000)==0xa000)throw new IOException("压缩包不支持符号链接。");
     string name=entry.FullName.Replace('\\','/');
     if(!String.IsNullOrEmpty(prefix)){
      if(name==prefix||name==prefix+"/")continue;
      if(!name.StartsWith(prefix+"/",StringComparison.Ordinal))throw new IOException("压缩包根目录不匹配。");name=name.Substring(prefix.Length+1);
     }
     if(name.EndsWith("/"))continue;
     if(wheel){
      string[] parts=name.Split('/');
      if(parts.Length>=3&&parts[0].EndsWith(".data",StringComparison.Ordinal)){
       string tail=String.Join("/",parts,2,parts.Length-2);
       if(parts[1]=="purelib"||parts[1]=="platlib")name="Lib/site-packages/"+tail;
       else if(parts[1]=="scripts")name="Scripts/"+tail;
       else if(parts[1]=="headers")name="Include/"+tail;
       else if(parts[1]=="data")name=tail;
       else throw new IOException("未知的 wheel 数据目录。");
      }else name="Lib/site-packages/"+name;
     }
     string file=Destination(root,name);if(!seen.Add(file))throw new IOException("压缩包包含重复路径。");
     total+=entry.Length;if(total>2L*1024*1024*1024)throw new IOException("解压大小超限。");
     Directory.CreateDirectory(Path.GetDirectoryName(file));CheckAncestors(file);
     string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
     try{
      using(Stream input=entry.Open())using(FileStream output=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None))input.CopyTo(output);
      if(new FileInfo(temp).Length!=entry.Length)throw new IOException("解压文件不完整。");
      if(File.Exists(file))File.Delete(file);File.Move(temp,file);
     }finally{if(File.Exists(temp))File.Delete(temp);}
    }
   }
  }
 }
}
