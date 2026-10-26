# temp: ask Windows itself to load and extract match5.ico.
# A: System.Drawing.Icon(fileName, w, h) - the framework picks the best frame for a requested
#    size, so this shows the multi-size directory is really navigable, not just present.
# B: SHGetFileInfo - the shell's own extraction path, at the list-view and icons-view sizes,
#    rendered out to PNG so the pixels can be looked at.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
$ico = (Resolve-Path 'match5.ico').Path
"file: $ico  $((Get-Item $ico).Length) bytes"

"`n== A. System.Drawing.Icon: request a size, report the frame that was selected =="
foreach ($t in 16, 20, 24, 32, 40, 48, 64, 96, 128, 256) {
    try {
        $i = New-Object System.Drawing.Icon($ico, $t, $t)
        $b = $i.ToBitmap()
        "  asked {0,3} -> selected {1}x{2}" -f $t, $i.Width, $i.Height
        if ($t -eq 256 -or $t -eq 48) { $b.Save("$PWD\qa\icon-shell-$($i.Width).png", [System.Drawing.Imaging.ImageFormat]::Png) }
        $b.Dispose(); $i.Dispose()
    }
    catch { "  asked {0,3} -> {1}" -f $t, $_.Exception.Message }
}

"`n== B. SHGetFileInfo: what the shell hands to Explorer =="
Add-Type -Namespace Win -Name Shell -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint dwAttributes;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szDisplayName;
    [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValTStr, SizeConst = 80)]
    public string szTypeName;
}
[System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern uint SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr h);
'@
$flags = [System.Runtime.InteropServices.Marshal]::SizeOf((New-Object 'Win.Shell+SHFILEINFO'))
foreach ($case in @(@('list view  SHGFI_SMALLICON ', 0x1), @('icons view SHGFI_LARGEICON ', 0x0))) {
    $label = $case[0]; $which = $case[1]
    $fi = New-Object 'Win.Shell+SHFILEINFO'
    $ok = [Win.Shell]::SHGetFileInfo($ico, 0, [ref]$fi, $flags, [uint32](0x100 -bor $which -bor 0x10))
    if ($ok -eq 0 -or $fi.hIcon -eq [IntPtr]::Zero) { "  $label -> the shell returned no icon"; continue }
    $ic = [System.Drawing.Icon]::FromHandle($fi.hIcon)
    $bmp = $ic.ToBitmap()
    $out = "$PWD\qa\icon-shell-$($bmp.Width).png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    "  $label -> hicon ok, rendered $($bmp.Width)x$($bmp.Height) -> $out"
    $bmp.Dispose(); $ic.Dispose(); [void][Win.Shell]::DestroyIcon($fi.hIcon)
}
