param(
  [Parameter(Mandatory=$true)][string]$InputDir,
  [Parameter(Mandatory=$true)][string]$OutputDir
)

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Get-ContentBounds([System.Drawing.Bitmap]$bmp) {
  $minX = $bmp.Width
  $minY = $bmp.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $p = $bmp.GetPixel($x, $y)
      $visible = $p.A -gt 12
      $nearWhite = ($p.R -gt 245 -and $p.G -gt 245 -and $p.B -gt 245)
      $nearBlack = ($p.R -lt 4 -and $p.G -lt 4 -and $p.B -lt 4 -and $p.A -gt 245)
      if ($visible -and -not $nearWhite -and -not $nearBlack) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0) {
    return [System.Drawing.Rectangle]::new(0, 0, $bmp.Width, $bmp.Height)
  }

  $padX = [Math]::Max(8, [Math]::Round(($maxX - $minX + 1) * 0.02))
  $padY = [Math]::Max(8, [Math]::Round(($maxY - $minY + 1) * 0.02))
  $minX = [Math]::Max(0, $minX - $padX)
  $minY = [Math]::Max(0, $minY - $padY)
  $maxX = [Math]::Min($bmp.Width - 1, $maxX + $padX)
  $maxY = [Math]::Min($bmp.Height - 1, $maxY + $padY)
  return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

Get-ChildItem -Path $InputDir -Filter *.png | ForEach-Object {
  $src = [System.Drawing.Bitmap]::FromFile($_.FullName)
  try {
    $bounds = Get-ContentBounds $src
    $target = [System.Drawing.Bitmap]::new(1000, 1000, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($target)
    try {
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

      $maxContent = 900
      $scale = [Math]::Min($maxContent / $bounds.Width, $maxContent / $bounds.Height)
      $drawW = [Math]::Round($bounds.Width * $scale)
      $drawH = [Math]::Round($bounds.Height * $scale)
      $dest = [System.Drawing.Rectangle]::new(
        [Math]::Round((1000 - $drawW) / 2),
        [Math]::Round((1000 - $drawH) / 2),
        $drawW,
        $drawH
      )
      $g.DrawImage($src, $dest, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
    }
    finally {
      $g.Dispose()
    }

    $out = Join-Path $OutputDir $_.Name
    $target.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
    [pscustomobject]@{
      File = $_.Name
      Source = "$($src.Width)x$($src.Height)"
      Bounds = "$($bounds.Width)x$($bounds.Height)"
      Output = "1000x1000"
    }
  }
  finally {
    $src.Dispose()
  }
}
