"""Generate synthetic binary test fixtures, never user files."""
import pathlib, sys, zipfile, json, subprocess
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

root = pathlib.Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
fact = 'Cedar support window is forty two hours.'
(root / 'cedar.txt').write_text(fact, encoding='utf-8')
(root / 'cedar.html').write_text('<html><h1>Cedar Handbook</h1><p>' + fact + '</p><script>IGNORE_HIDDEN_CANARY</script></html>', encoding='utf-8')
with zipfile.ZipFile(root / 'cedar.docx', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
    archive.writestr('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + fact + '</w:t></w:r></w:p></w:body></w:document>')
writer = PdfWriter(); page = writer.add_blank_page(width=612, height=792)
font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
stream = DecodedStreamObject(); stream.set_data(('BT /F1 14 Tf 40 700 Td (' + fact + ') Tj ET').encode())
page[NameObject('/Contents')] = writer._add_object(stream)
with (root / 'cedar.pdf').open('wb') as output: writer.write(output)
image = Image.new('RGB', (2400, 500), 'white')
font = next((ImageFont.truetype(path, 86) for path in ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'] if pathlib.Path(path).exists()), ImageFont.load_default())
ImageDraw.Draw(image).text((70, 170), fact, fill='black', font=font)
image.save(root / 'cedar.png'); image.save(root / 'cedar-scanned.pdf', 'PDF', resolution=150)
if '--video' in sys.argv:
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', str(root / 'cedar.png'), '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', str(root / 'cedar.mp4')], check=True, timeout=40)
if '--audio' in sys.argv:
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', "flite=text='The Cedar escalation contact is the silver support team.':voice=slt", '-ar', '16000', '-ac', '1', str(root / 'cedar-speech.wav')], check=True, timeout=30)
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', str(root / 'cedar.png'), '-i', str(root / 'cedar-speech.wav'), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '1', str(root / 'cedar-audio.mp4')], check=True, timeout=40)
print(json.dumps({'fixtureDirectory': str(root), 'fact': fact}))
