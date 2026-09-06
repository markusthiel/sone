import base64, os, io
import cairosvg
from gen import OUT, write, INK, MUTED_LIGHT, ACCENT_LIGHT
# 2x for retina, displayed at 132px
png = cairosvg.svg2png(url=os.path.join(OUT,"logo/svg/sone-logo-horizontal-light.svg"), output_width=264)
b64 = base64.b64encode(png).decode()
html = f"""<!-- SONE E-Mail-Signatur. In Outlook/Apple Mail/Thunderbird als HTML einfuegen.
     Das Logo steckt als data-URI drin, damit die Signatur ohne externen Abruf
     funktioniert; wo der Client data-URIs blockt (aeltere Outlook-Versionen),
     das PNG anhaengen oder auf eine URL umstellen: siehe zweite Variante unten. -->
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;color:{INK};">
  <tr>
    <td style="padding:0 0 10px 0;">
      <img src="data:image/png;base64,{b64}" width="132" height="31" alt="SONE" style="display:block;border:0;">
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 2px 0;font-size:14px;line-height:20px;font-weight:600;">&laquo;Name&raquo;</td>
  </tr>
  <tr>
    <td style="padding:0 0 8px 0;font-size:12px;line-height:18px;color:{MUTED_LIGHT};font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.04em;">&laquo;Funktion&raquo;</td>
  </tr>
  <tr>
    <td style="padding:8px 0 0 0;border-top:1px solid #ddd9d0;font-size:12px;line-height:19px;color:{MUTED_LIGHT};font-family:'JetBrains Mono',Consolas,monospace;">
      &laquo;E-Mail&raquo;<br>
      <a href="https://&laquo;server&raquo;" style="color:{ACCENT_LIGHT};text-decoration:none;">&laquo;server&raquo;</a>
    </td>
  </tr>
</table>

<!-- Variante mit gehostetem Logo: <img> oben ersetzen durch
     <img src="https://&laquo;server&raquo;/brand/sone-logo-horizontal-light-400.png" width="132" height="31" alt="SONE" style="display:block;border:0;"> -->
"""
write("office/sone-email-signatur.html", html)
open(os.path.join(OUT,"office/sone-email-signatur-logo.png"),"wb").write(png)
print("signature", len(html))
