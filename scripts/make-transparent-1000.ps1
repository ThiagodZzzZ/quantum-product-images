param(
  [Parameter(Mandatory=$true)][string]$InputDir,
  [Parameter(Mandatory=$true)][string]$OutputDir
)

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class QuantumImageProcessor {
  static bool IsBg(byte b, byte g, byte r, byte a) {
    bool nearWhite = r > 242 && g > 242 && b > 242;
    bool nearBlack = r < 4 && g < 4 && b < 4 && a > 245;
    return a <= 12 || nearWhite || nearBlack;
  }

  static bool Visible(byte b, byte g, byte r, byte a) {
    return a > 12;
  }

  public static string Process(string inputPath, string outputPath) {
    using (var original = new Bitmap(inputPath))
    using (var source = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(source)) {
        g.Clear(Color.Transparent);
        g.DrawImage(original, 0, 0, original.Width, original.Height);
      }

      int w = source.Width;
      int h = source.Height;
      var rect = new Rectangle(0, 0, w, h);
      var bd = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      int stride = bd.Stride;
      byte[] pixels = new byte[Math.Abs(stride) * h];
      Marshal.Copy(bd.Scan0, pixels, 0, pixels.Length);
      source.UnlockBits(bd);

      bool[] bg = new bool[w * h];
      var q = new Queue<int>();
      Action<int,int> add = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        int idx = y * w + x;
        if (bg[idx]) return;
        int p = y * stride + x * 4;
        if (IsBg(pixels[p], pixels[p+1], pixels[p+2], pixels[p+3])) {
          bg[idx] = true;
          q.Enqueue(idx);
        }
      };

      for (int x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
      for (int y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
      while (q.Count > 0) {
        int idx = q.Dequeue();
        int x = idx % w;
        int y = idx / w;
        add(x + 1, y); add(x - 1, y); add(x, y + 1); add(x, y - 1);
      }

      int minX = w, minY = h, maxX = -1, maxY = -1;
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int idx = y * w + x;
          int p = y * stride + x * 4;
          if (bg[idx]) pixels[p+3] = 0;
          if (Visible(pixels[p], pixels[p+1], pixels[p+2], pixels[p+3])) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
      int bw = maxX - minX + 1;
      int bh = maxY - minY + 1;
      int padX = Math.Max(8, (int)Math.Round(bw * 0.02));
      int padY = Math.Max(8, (int)Math.Round(bh * 0.02));
      minX = Math.Max(0, minX - padX);
      minY = Math.Max(0, minY - padY);
      maxX = Math.Min(w - 1, maxX + padX);
      maxY = Math.Min(h - 1, maxY + padY);
      var bounds = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);

      using (var clean = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        var cd = clean.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(pixels, 0, cd.Scan0, pixels.Length);
        clean.UnlockBits(cd);

        using (var target = new Bitmap(1000, 1000, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(target)) {
          g.Clear(Color.Transparent);
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.SmoothingMode = SmoothingMode.HighQuality;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.CompositingQuality = CompositingQuality.HighQuality;

          const int maxContent = 900;
          double scale = Math.Min((double)maxContent / bounds.Width, (double)maxContent / bounds.Height);
          int drawW = (int)Math.Round(bounds.Width * scale);
          int drawH = (int)Math.Round(bounds.Height * scale);
          var dest = new Rectangle((1000 - drawW) / 2, (1000 - drawH) / 2, drawW, drawH);
          g.DrawImage(clean, dest, bounds, GraphicsUnit.Pixel);
          target.Save(outputPath, ImageFormat.Png);
        }
      }

      return String.Format("{0} {1}x{2} bounds {3}x{4} -> 1000x1000", Path.GetFileName(outputPath), w, h, bounds.Width, bounds.Height);
    }
  }
}
"@

Get-ChildItem -Path $InputDir -File |
  Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' } |
  ForEach-Object {
    $outName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name) + ".png"
    $out = Join-Path $OutputDir $outName
    [QuantumImageProcessor]::Process($_.FullName, $out)
  }
