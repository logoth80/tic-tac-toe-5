# Does a decoder that is not mine read the same pixels?
#
# tests/ico-png.mjs reads frames out of match5.ico and writes them back as PNG by hand: an ICO
# directory walk, a bottom-up BGRA decode, a filter pass, a zlib stream, a CRC32. Two of those are
# things a wrong sign or an off-by-one survives badly. Chrome already accepts the result, and
# tests/file-check.mjs proves the page holds exactly those bytes - but both of those read the same
# code that wrote them.
#
# This asks two things that are not that code: System.Drawing to decode the PNG, and PowerShell itself
# to walk the ICO. Then it compares the pixels. Windows only, like icon-shell-check.ps1.
#
#   node qa/dump-icon-png.mjs           # writes qa/icon-16.png and qa/icon-32.png from those bytes
#   powershell -File qa/favicon-pixel-check.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# --- System.Drawing: the PNG the page carries ---
Add-Type -AssemblyName System.Drawing
function Read-Png($path) {
    $fs = [System.IO.File]::OpenRead($path)
    try {
        $bmp = New-Object System.Drawing.Bitmap $fs
        try {
            $px = @()
            for ($y = 0; $y -lt $bmp.Height; $y++) {
                for ($x = 0; $x -lt $bmp.Width; $x++) {
                    $c = $bmp.GetPixel($x, $y)
                    $px += , @($c.R, $c.G, $c.B, $c.A)
                }
            }
            return @{ w = $bmp.Width; h = $bmp.Height; px = $px }
        } finally { $bmp.Dispose() }
    } finally { $fs.Dispose() }
}

# --- PowerShell's own walk of the ICO: directory, then the bottom-up BGRA rows ---
function Read-IcoFrame($bytes, $want) {
    $count = [BitConverter]::ToUInt16($bytes, 4)
    for ($i = 0; $i -lt $count; $i++) {
        $e = 6 + $i * 16
        $w = if ($bytes[$e] -eq 0) { 256 } else { [int]$bytes[$e] }
        $h = if ($bytes[$e + 1] -eq 0) { 256 } else { [int]$bytes[$e + 1] }
        if ($w -ne $want -or $h -ne $want) { continue }
        $off = [BitConverter]::ToUInt32($bytes, $e + 12)
        if ([BitConverter]::ToUInt32($bytes, $off) -ne 40) { throw "$($want)px frame is not a BITMAPINFOHEADER" }
        if ([BitConverter]::ToInt32($bytes, $off + 8) -ne 2 * $want) { throw "$($want)px: biHeight is not doubled" }
        $px = @()
        for ($row = $want - 1; $row -ge 0; $row--) {
            $s = $off + 40 + $row * $want * 4
            for ($x = 0; $x -lt $want; $x++) {
                $px += , @([int]$bytes[$s + $x * 4 + 2], [int]$bytes[$s + $x * 4 + 1],
                           [int]$bytes[$s + $x * 4], [int]$bytes[$s + $x * 4 + 3])
            }
        }
        return @{ w = $w; h = $h; px = $px }
    }
    throw "no $want px frame in the file"
}

$ico = [System.IO.File]::ReadAllBytes((Join-Path $root 'match5.ico'))
$fails = 0
foreach ($size in 16, 32) {
    $pngPath = Join-Path $root ('qa\icon-' + $size + '.png')
    if (-not (Test-Path $pngPath)) { Write-Output "SKIP $size px: no $pngPath (run qa/dump-icon-png.mjs)"; continue }
    $a = Read-Png $pngPath
    $b = Read-IcoFrame $ico $size
    if ($a.w -ne $size -or $a.h -ne $size) { Write-Output "FAIL $size px: System.Drawing reads the PNG as $($a.w)x$($a.h)"; $fails++ }
    # An alpha-carrying bitmap in GDI+ is stored with *premultiplied* colour, so an edge pixel's RGB is
    # expected to differ from the ICO's straight-alpha RGB by the factor of its own alpha. Both readings
    # are counted; anything that is neither is a real difference.
    $exact = 0; $premul = 0; $first = $null
    for ($i = 0; $i -lt $b.px.Count; $i++) {
        $want = $b.px[$i]; $got = $a.px[$i]
        if ($want[0] -eq $got[0] -and $want[1] -eq $got[1] -and $want[2] -eq $got[2] -and $want[3] -eq $got[3]) {
            $exact++; continue
        }
        $isPremul = ($want[3] -eq $got[3])
        if ($isPremul) {
            for ($ch = 0; $ch -lt 3; $ch++) {
                $expect = [Math]::Round($want[$ch] * $want[3] / 255)
                if ([Math]::Abs($got[$ch] - $expect) -gt 1) { $isPremul = $false }
            }
        }
        if ($isPremul) { $premul++ } elseif (-not $first) {
            $first = @{ i = $i; png = ($got -join ','); ico = ($want -join ',') }
        }
    }
    $total = $b.px.Count
    if (-not $first) {
        $how = if ($premul) { ", plus $premul that agree once alpha is multiplied in (GDI+ stores it that way)" } else { '' }
        Write-Output ("ok {0,2} px: {1} of {2} pixels read identically{3}" -f $size, $exact, $total, $how)
    } else {
        $fails++
        $msg = "FAIL {0,2} px: {1} exact, {2} premultiplied, {3} of {4} pixels unexplained" -f $size, $exact, $premul, ($total - $exact - $premul), $total
        $msg += " - first difference at pixel $($first.i): PNG $($first.png) against ICO $($first.ico)"
        Write-Output $msg
    }
}
if ($fails) { Write-Output "FAILED: $fails"; exit 1 }
Write-Output "PIXELS OK - a decoder that did not write them reads the same picture"
