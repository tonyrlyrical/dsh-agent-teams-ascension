Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-05-clicked-new-session.png")

for ($x = 250; $x -lt 1600; $x += 50) {
    $c = $bmp.GetPixel($x, 540)
    Write-Host "x=$x : R=$($c.R), G=$($c.G), B=$($c.B)"
}
$bmp.Dispose()
