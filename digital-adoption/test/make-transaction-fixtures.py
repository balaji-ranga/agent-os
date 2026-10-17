"""Synthetic private-task acceptance corpus. Never reads user documents."""
import pathlib, sys, zipfile
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
root=pathlib.Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
lines=['Company name: Synthetic Orchid','Contact email: orchid@example.test','Region: Singapore','Requested integration: Inventory API','Transport: HTTP','Title: Delivery handoff','Body: Prepare a shipment for Synthetic Orchid']
text='\n'.join(lines)
(root/'onboarding.txt').write_text(text,encoding='utf-8')
writer=PdfWriter(); page=writer.add_blank_page(width=612,height=792)
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
stream=DecodedStreamObject(); stream.set_data(('BT /F1 13 Tf 40 730 Td 25 TL '+' Tj T* '.join('('+line+')' for line in lines)+' Tj ET').encode()); page[NameObject('/Contents')]=writer._add_object(stream)
with (root/'onboarding.pdf').open('wb') as out: writer.write(out)
image=Image.new('RGB',(1800,800),'white'); draw=ImageDraw.Draw(image)
font_path=next(p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','C:/Windows/Fonts/arial.ttf'] if pathlib.Path(p).exists())
font=ImageFont.truetype(font_path,42)
for i,line in enumerate(lines): draw.text((60,60+i*85),line,font=font,fill='black')
image.save(root/'onboarding.png'); image.save(root/'onboarding.jpg')
with zipfile.ZipFile(root/'onboarding.docx','w',compression=zipfile.ZIP_DEFLATED) as archive:
 archive.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
 archive.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join('<w:p><w:r><w:t>'+line+'</w:t></w:r></w:p>' for line in lines)+'</w:body></w:document>')
print('Generated synthetic PDF, DOCX, text, PNG and JPEG transaction corpus')
