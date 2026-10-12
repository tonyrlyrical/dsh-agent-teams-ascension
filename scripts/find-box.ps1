Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile("D:\AGENTS TEAMS V2\evidence\desktop-validation\screenshots\harness-gui-05-clicked-new-session.png")
Write-Host "Width: $($bmp.Width), Height: $($bmp.Height)"

# Find the bounding box of the input area around y = 540
$targetY = 540
$minX = -1
$maxX = -1

for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $targetY)
    # The background of the input box is around RGB (36, 36, 36) or similar dark grey (#242424)
    # Main background is RGB (20, 20, 20) or (24, 24, 24)
    if ($c.R -gt 30 -and $c.G -gt 30 -and $c.B -gt 30) {
        if ($minX -eq -1) { $minX = $x }
        $maxX = $x
    }
}

Write-Host "At Y=540, box spans X from $minX to $maxX"

# Also find vertical range at center X
$centerX = [int](($minX + $maxX) / 2)
$minY = -1
$maxY = -1
for ($y = 0; $y -lt $bmp.Height; $y++) {
    $c = $bmp.GetPixel($centerX, $y)
    if ($c.R -gt 30 -and $c.G -gt 30 -and $c.B -gt 30) {
        if ($minY -eq -1) { $minY = $y }
        $maxY = $y
    }
}

Write-Host "At X=$centerX, box spans Y from $minY to $maxY"
$bmp.Dispose()
