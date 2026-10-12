"""Bounded document conversion worker. No network fetching, macros or shell input.

Run only in the private non-root converter container in production. The backend
scans input before this worker and scans every output before publishing it.
"""
import base64
import csv
import html
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import warnings as python_warnings
from pathlib import Path

from bs4 import BeautifulSoup
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from markdown import markdown
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

MAX_BYTES = 25 * 1024 * 1024
MAX_PAGES = 20
MAX_TEXT = 500000
Image.MAX_IMAGE_PIXELS = 20_000_000
python_warnings.simplefilter('error', Image.DecompressionBombWarning)
FORMATS = {'pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md', 'html', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'}
MIMES = {'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'doc': 'application/msword', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'txt': 'text/plain', 'html': 'text/html', 'png': 'image/png', 'jpg': 'image/jpeg'}


class ConversionError(Exception):
    def __init__(self, message, code='INVALID_CONTENT'):
        super().__init__(message)
        self.code = code


def run(args, timeout=45):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
                                check=False, shell=False)
    except FileNotFoundError:
        raise ConversionError('Required conversion component is unavailable.', 'CONVERTER_UNAVAILABLE')
    except subprocess.TimeoutExpired:
        raise ConversionError('Conversion component timed out.', 'CONVERSION_TIMEOUT')
    if result.returncode:
        raise ConversionError('The document could not be processed by the conversion component.', 'CONVERSION_FAILED')
    return result.stdout


def safe_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 2048 or sum(item.file_size for item in members) > 75 * 1024 * 1024:
            raise ConversionError('Office document exceeds expanded-size limits.', 'CONTENT_LIMIT')
        for item in members:
            if item.flag_bits & 1 or '..' in Path(item.filename).parts or item.filename.startswith(('/', '\\')):
                raise ConversionError('Unsafe or encrypted Office archive.', 'UNSAFE_OFFICE')
            if 'vbaproject' in item.filename.lower() or 'embeddings/' in item.filename.lower() or 'activex/' in item.filename.lower():
                raise ConversionError('Macro, embedded-object and ActiveX Office files are not supported.', 'UNSAFE_OFFICE')


def sanitize_html(source):
    soup = BeautifulSoup(source, 'html.parser')
    for tag in soup.find_all(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math', 'link', 'meta', 'base']):
        tag.decompose()
    for tag in soup.find_all('img'):
        tag.replace_with(tag.get('alt', ''))  # Never resolve external/local HTML resources.
    allowed = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'blockquote', 'br', 'a'}
    for tag in list(soup.find_all(True)):
        if tag.name not in allowed:
            tag.unwrap()
            continue
        attrs = {}
        if tag.name == 'a' and re.match(r'^https://[^\s<>]+$', str(tag.get('href', ''))):
            attrs['href'] = tag['href']
        tag.attrs = attrs
    return str(soup)


def blocks_from_html(source):
    soup = BeautifulSoup(sanitize_html(source), 'html.parser')
    blocks = []
    for node in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'table', 'blockquote']):
        if node.find_parent(['table', 'li', 'blockquote', 'pre']):
            continue
        text = node.get_text(' ', strip=True)
        if node.name == 'table':
            rows = [[cell.get_text(' ', strip=True) for cell in row.find_all(['td', 'th'], recursive=False)] for row in node.find_all('tr')]
            if rows:
                blocks.append({'type': 'table', 'rows': rows})
        elif re.match(r'^h[1-6]$', node.name):
            blocks.append({'type': 'heading', 'level': int(node.name[1]), 'text': text})
        elif text:
            blocks.append({'type': 'list' if node.name == 'li' else 'paragraph', 'text': text, 'html': node.decode_contents()})
    if not blocks and soup.get_text(' ', strip=True):
        blocks.append({'type': 'paragraph', 'text': soup.get_text(' ', strip=True)})
    return blocks


def validate_blocks(blocks):
    if not isinstance(blocks, list) or len(blocks) > 2000:
        raise ConversionError('Formatted input must contain at most 2000 blocks.', 'CONTENT_LIMIT')
    total = 0
    for block in blocks:
        if not isinstance(block, dict) or block.get('type') not in ('heading', 'paragraph', 'list', 'table'):
            raise ConversionError('Unknown formatted-input block.')
        if block['type'] == 'table':
            rows = block.get('rows', [])
            if not isinstance(rows, list) or len(rows) > 2000 or any(not isinstance(row, list) or len(row) > 50 for row in rows):
                raise ConversionError('Table exceeds 2000 rows or 50 columns.', 'CONTENT_LIMIT')
            if sum(len(row) for row in rows) > 100000:
                raise ConversionError('Table exceeds cell limit.', 'CONTENT_LIMIT')
            for row in rows:
                if any(not isinstance(cell, (str, int, float, bool, type(None))) for cell in row):
                    raise ConversionError('Table cells must be scalar values.')
                total += sum(len(str(cell)) for cell in row)
        else:
            if not isinstance(block.get('text', ''), str):
                raise ConversionError('Block text must be a string.')
            total += len(block.get('text', ''))
        if total > MAX_TEXT:
            raise ConversionError('Extracted text exceeds limit.', 'CONTENT_LIMIT')
    return blocks


def text_for_blocks(blocks):
    return '\n\n'.join('\n'.join('\t'.join('' if cell is None else str(cell) for cell in row) for row in block['rows'])
                       if block['type'] == 'table' else block.get('text', '') for block in blocks)


def html_for_blocks(blocks):
    body = []
    for block in blocks:
        if block['type'] == 'table':
            body.append('<table>' + ''.join('<tr>' + ''.join('<%s>%s</%s>' % ('th' if i == 0 else 'td', html.escape('' if cell is None else str(cell)), 'th' if i == 0 else 'td') for cell in row) + '</tr>' for i, row in enumerate(block['rows'])) + '</table>')
        else:
            tag = 'h' + str(max(1, min(6, int(block.get('level', 1))))) if block['type'] == 'heading' else 'p'
            body.append('<%s>%s</%s>' % (tag, sanitize_html(block['html']) if block.get('html') else html.escape(block.get('text', '')), tag))
    return '<!doctype html><html><head><meta charset="utf-8"><title>Converted document</title><style>body{font:12pt Arial,sans-serif;max-width:900px;margin:40px auto;padding:20px;color:#111}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #d9d9d9;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#e8edf2}p{white-space:pre-wrap}</style></head><body>' + ''.join(body) + '</body></html>'


def docx_for_blocks(blocks, path):
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    section.top_margin = section.bottom_margin = section.left_margin = section.right_margin = Inches(.75)
    for name in ['Normal', 'Title', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']:
        doc.styles[name].font.name = 'Arial'
        doc.styles[name].font.color.rgb = RGBColor(0, 0, 0)
    doc.styles['Normal'].font.size = Pt(11)
    for block in blocks:
        if block['type'] == 'table':
            rows = block['rows']
            if not rows:
                continue
            width = max(len(row) for row in rows)
            if width > 12:
                raise ConversionError('Word/PDF tables support at most 12 columns; use Excel for wider tables.', 'CONTENT_LIMIT')
            table = doc.add_table(rows=0, cols=width)
            table.style = 'Table Grid'
            for i, row in enumerate(rows):
                cells = table.add_row().cells
                for j, cell in enumerate(cells):
                    cell.text = '' if j >= len(row) or row[j] is None else str(row[j])
                    borders = OxmlElement('w:tcBorders')
                    for edge in ['top', 'left', 'bottom', 'right']:
                        border = OxmlElement('w:' + edge)
                        border.set(qn('w:val'), 'single'); border.set(qn('w:sz'), '4'); border.set(qn('w:color'), 'D9D9D9')
                        borders.append(border)
                    cell._tc.get_or_add_tcPr().append(borders)
                    shading = OxmlElement('w:shd'); shading.set(qn('w:fill'), '243B53' if i == 0 else 'F3F5F7' if i % 2 == 0 else 'FFFFFF')
                    cell._tc.get_or_add_tcPr().append(shading)
                    if i == 0:
                        for run_item in cell.paragraphs[0].runs:
                            run_item.bold = True; run_item.font.color.rgb = RGBColor(255, 255, 255)
                if i == 0:
                    repeat = OxmlElement('w:tblHeader'); table.rows[0]._tr.get_or_add_trPr().append(repeat)
            doc.add_paragraph()
        elif block['type'] == 'heading':
            doc.add_paragraph(block.get('text', ''), 'Title' if not doc.paragraphs and block.get('level', 1) == 1 else 'Heading ' + str(max(1, min(6, int(block.get('level', 1))))))
        else:
            para=doc.add_paragraph(style='List Bullet' if block['type'] == 'list' else None)
            if block.get('html'):
                inline=BeautifulSoup(sanitize_html(block['html']),'html.parser')
                for text_node in inline.find_all(string=True):
                    item=para.add_run(str(text_node))
                    item.bold=bool(text_node.find_parent(['b','strong']))
                    item.italic=bool(text_node.find_parent(['i','em']))
            else:
                para.add_run(block.get('text',''))
    doc.core_properties.author = 'Flolah'
    doc.save(path)


def pdf_for_blocks(blocks, path):
    styles = getSampleStyleSheet()
    font_path=os.environ.get('CONVERTER_PDF_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    if Path(font_path).is_file():
        pdfmetrics.registerFont(TTFont('ContentSans',font_path))
        font_dir=Path(font_path).parent
        for face,suffix in [('ContentSans-Bold','-Bold'),('ContentSans-Oblique','-Oblique'),('ContentSans-BoldOblique','-BoldOblique')]:
            font=font_dir/('DejaVuSans'+suffix+'.ttf')
            pdfmetrics.registerFont(TTFont(face,str(font) if font.is_file() else font_path))
        pdfmetrics.registerFontFamily('ContentSans',normal='ContentSans',bold='ContentSans-Bold',italic='ContentSans-Oblique',boldItalic='ContentSans-BoldOblique')
        for style in styles.byName.values():style.fontName='ContentSans'
    for name in ['Heading1','Heading2','Heading3']:styles[name].textColor=colors.black
    styles['Normal'].fontSize = 11; styles['Normal'].leading = 15
    story = []
    for block in blocks:
        if block['type'] == 'table' and block['rows']:
            rows = block['rows']; columns = max(len(row) for row in rows)
            if columns > 12:
                raise ConversionError('PDF tables support at most 12 columns.', 'CONTENT_LIMIT')
            cells = [[Paragraph(html.escape('' if j >= len(row) or row[j] is None else str(row[j])), styles['Normal']) for j in range(columns)] for row in rows]
            table = Table(cells, colWidths=[468 / columns] * columns, repeatRows=1)
            table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8edf2')), ('GRID', (0, 0), (-1, -1), .4, colors.HexColor('#d9d9d9')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
            story.append(table)
        else:
            style = styles['Heading' + str(min(3, max(1, int(block.get('level', 1)))))] if block['type'] == 'heading' else styles['Normal']
            inline=sanitize_html(block['html']) if block.get('html') else html.escape(block.get('text','')).replace('\n','<br/>')
            # ReportLab supports a smaller inline vocabulary than HTML.
            inline=re.sub(r'</?(?:p|ul|ol|li|pre|code|blockquote)[^>]*>','',inline)
            story.append(Paragraph(inline, style))
        story.append(Spacer(1, 10))
    SimpleDocTemplate(str(path), pagesize=(612, 792), leftMargin=72, rightMargin=72, topMargin=54, bottomMargin=54).build(story)


def xlsx_for_blocks(blocks, path):
    workbook = Workbook(); workbook.remove(workbook.active)
    tables = [block['rows'] for block in blocks if block['type'] == 'table' and block['rows']]
    if not tables:
        tables = [[['Content']] + [[block.get('text', '')] for block in blocks]]
    for index, rows in enumerate(tables):
        sheet = workbook.create_sheet('Content' if len(tables) == 1 else 'Table ' + str(index + 1))
        sheet.sheet_view.showGridLines = False
        for i, row in enumerate(rows, 1):
            for j, value in enumerate(row, 1):
                if isinstance(value, str) and re.fullmatch(r'-?(?:0|[1-9]\d*)(?:\.\d+)?', value.strip()):
                    value = float(value) if '.' in value else int(value)
                cell = sheet.cell(i, j, value)
                if isinstance(value, str):
                    cell.data_type = 's'  # No formula/DDE injection from source content.
                cell.font = Font(name='Arial', size=11, color='FFFFFF' if i == 1 else '111111', bold=i == 1)
                cell.alignment = Alignment(vertical='center', horizontal='center' if i == 1 else 'right' if isinstance(value, (int, float)) else 'left', wrap_text=True)
                if i == 1:
                    cell.fill = PatternFill('solid', fgColor='243B53')
            sheet.row_dimensions[i].height = 30 if i == 1 else 28
        for col in sheet.columns:
            longest = max(len(str(cell.value or '')) for cell in col)
            sheet.column_dimensions[col[0].column_letter].width = max(14, min(45, longest + 3))
        if len(rows) > 20:
            sheet.freeze_panes = 'A2'
        sheet.print_options.horizontalCentered = True
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.page_setup.fitToWidth = 1; sheet.page_setup.fitToHeight = 0
    workbook.save(path)


def office_convert(source, target_format, directory):
    profile = directory / 'lo-profile'; profile.mkdir(exist_ok=True)
    # Macro execution, updates and online content are disabled; container has no public egress.
    (profile / 'user').mkdir(exist_ok=True)
    (profile / 'user' / 'registrymodifications.xcu').write_text('<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>', encoding='utf8')
    output = directory / 'office-output'; output.mkdir(exist_ok=True)
    filters = {'pdf': 'pdf', 'docx': 'docx:Office Open XML Text', 'doc': 'doc:MS Word 97', 'xlsx': 'xlsx:Calc MS Excel 2007 XML'}
    run([os.environ.get('CONVERTER_SOFFICE', 'soffice'), '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', filters[target_format], '--outdir', str(output), str(source)])
    result = output / (source.stem + '.' + target_format)
    if not result.is_file() or not result.stat().st_size:
        raise ConversionError('Office conversion produced no output.', 'CONVERSION_FAILED')
    if result.stat().st_size>MAX_BYTES:
        raise ConversionError('Office conversion output exceeds 25 MiB.', 'CONTENT_LIMIT')
    return result


def pdf_pages(source):
    reader = PdfReader(source)
    if reader.is_encrypted:
        raise ConversionError('Encrypted PDFs are not supported.', 'ENCRYPTED_CONTENT')
    root = reader.trailer['/Root']
    names=root['/Names'] if '/Names' in root else {}
    action=root.get('/OpenAction')
    if action is not None:
        action=action.get_object()
        # LibreOffice uses a local /GoTo page destination, not executable code.
        local_destination=isinstance(action,list) or (isinstance(action,dict) and action.get('/S')=='/GoTo' and '/Next' not in action)
        if not local_destination:
            raise ConversionError('Active PDF actions are not supported.', 'UNSAFE_PDF')
    if '/AA' in root or '/JavaScript' in names:
        raise ConversionError('Active PDF actions are not supported.', 'UNSAFE_PDF')
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise ConversionError('PDF exceeds the 20-page limit.', 'CONTENT_LIMIT')
    for page in reader.pages:
        if float(page.mediabox.width) * float(page.mediabox.height) > 2_000_000:
            raise ConversionError('PDF page dimensions exceed rendering limits.', 'CONTENT_LIMIT')
    return reader


def pdf_images(source, directory, image_format='png'):
    pdf_pages(source)
    prefix = directory / 'page'
    run([os.environ.get('CONVERTER_PDFTOPPM', 'pdftoppm'), '-r', '150', '-scale-to', '2200', '-jpeg' if image_format == 'jpg' else '-png', str(source), str(prefix)], timeout=90)
    return sorted(directory.glob('page-*.' + ('jpg' if image_format == 'jpg' else 'png')), key=lambda p: int(re.search(r'-(\d+)\.', p.name)[1]))


def ocr_image(source, language='eng'):
    if not re.fullmatch(r'(?:eng|spa|fra|deu)(?:\+(?:eng|spa|fra|deu))*', language):
        raise ConversionError('OCR language must be eng, spa, fra, deu or a plus-separated combination.')
    return run([os.environ.get('CONVERTER_TESSERACT', 'tesseract'), str(source), 'stdout', '-l', language, '--psm', '3'], timeout=30).decode('utf8').strip()


def convert(payload):
    fmt = str(payload.get('input_format', 'txt')).lower()
    output = str(payload.get('output_format', 'txt')).lower()
    output = {'word': 'docx', 'excel': 'xlsx', 'text': 'txt', 'image': 'png', 'jpeg': 'jpg'}.get(output, output)
    operation = payload.get('operation', 'convert')
    ocr = payload.get('ocr', 'auto')
    if fmt not in FORMATS | {'formatted'} or output not in MIMES or operation not in ('generate', 'convert', 'ocr') or ocr not in ('auto', 'force', 'off'):
        raise ConversionError('Unsupported format, operation or OCR mode.')
    data = base64.b64decode(payload.get('content_base64', ''), validate=True)
    if not data or len(data) > MAX_BYTES:
        raise ConversionError('Content must be non-empty and at most 25 MiB.', 'CONTENT_LIMIT')
    warnings = []; used_ocr = False
    with tempfile.TemporaryDirectory(prefix='flolah-convert-') as work:
        directory = Path(work); source = directory / ('input.' + fmt); source.write_bytes(data)
        if fmt in ('docx', 'xlsx'):
            safe_zip(data)
        if fmt == 'doc':
            if not data.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):
                raise ConversionError('Invalid legacy Word document.')
            source = office_convert(source, 'docx', directory); fmt = 'docx'; safe_zip(source.read_bytes())
        if fmt == 'xls':
            source = office_convert(source, 'xlsx', directory); fmt = 'xlsx'; safe_zip(source.read_bytes())
        if fmt in ('docx', 'xlsx') and output == 'pdf' and operation != 'ocr':
            result = office_convert(source, 'pdf', directory); pdf_pages(result)
            return response([result], output, warnings, False)
        if fmt == 'pdf':
            reader = pdf_pages(source)
            if output == 'pdf' and operation != 'ocr' and ocr != 'force':
                return response([source], output, warnings, False)
            if output in ('png', 'jpg'):
                return response(pdf_images(source, directory, output), output, warnings, False)
            page_text = [page.extract_text() or '' for page in reader.pages]
            if operation == 'ocr' or ocr == 'force' or (ocr == 'auto' and any(not text.strip() for text in page_text)):
                images = pdf_images(source, directory)
                page_text = [ocr_image(images[i], payload.get('language', 'eng')) if operation == 'ocr' or ocr == 'force' or not text.strip() else text for i, text in enumerate(page_text)]
                used_ocr = True
            if any(not text.strip() for text in page_text):
                warnings.append('Some pages have no extractable text; enable OCR for scanned pages.')
            blocks = [{'type': 'paragraph', 'text': text} for text in page_text if text.strip()]
            warnings.append('PDF conversion reconstructs editable text; original columns, tables and graphics may not be preserved.')
        elif fmt in ('png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'):
            with Image.open(source) as image:
                image.load()
                if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise ConversionError('Image exceeds pixel limit.', 'CONTENT_LIMIT')
                if output == 'pdf' and operation != 'ocr' and ocr != 'force':
                    result = directory / 'output.pdf'; image.convert('RGB').save(result, 'PDF', resolution=150)
                    return response([result], output, warnings, False)
                normalized = directory / 'ocr-input.png'; image.convert('RGB').save(normalized)
            if ocr == 'off' and operation != 'ocr':
                raise ConversionError('Image-to-text/Word/Excel conversion requires OCR.')
            blocks = [{'type': 'paragraph', 'text': ocr_image(normalized, payload.get('language', 'eng'))}]; used_ocr = True
        elif fmt == 'docx':
            doc = Document(source)
            blocks = []
            for node in doc.element.body:
                if node.tag == qn('w:p'):
                    from docx.text.paragraph import Paragraph as DocParagraph
                    para = DocParagraph(node, doc)
                    if para.text.strip():
                        heading = re.match(r'Heading ([1-6])', para.style.name)
                        blocks.append({'type': 'heading' if heading else 'paragraph', 'text': para.text, **({'level': int(heading[1])} if heading else {})})
                elif node.tag == qn('w:tbl'):
                    from docx.table import Table as DocTable
                    blocks.append({'type': 'table', 'rows': [[cell.text for cell in row.cells] for row in DocTable(node, doc).rows]})
        elif fmt == 'xlsx':
            book = load_workbook(source, read_only=True, data_only=True, keep_links=False)
            blocks = []
            for sheet in book.worksheets:
                if sheet.max_row > 2000 or sheet.max_column > 50:
                    raise ConversionError('Spreadsheet exceeds row/column limit.', 'CONTENT_LIMIT')
                blocks += [{'type': 'heading', 'text': sheet.title, 'level': 1}, {'type': 'table', 'rows': [[value.isoformat() if hasattr(value,'isoformat') else value for value in row] for row in sheet.iter_rows(values_only=True)]}]
            book.close(); warnings.append('Spreadsheet import uses cached values; formulas and workbook-specific features are not preserved.')
        elif fmt == 'formatted':
            blocks = json.loads(data.decode('utf8'))
        elif fmt in ('md', 'html'):
            text = data.decode('utf8', errors='strict')
            blocks = blocks_from_html(markdown(text, extensions=['tables', 'fenced_code']) if fmt == 'md' else text)
        elif fmt == 'csv':
            rows = list(csv.reader(io.StringIO(data.decode('utf8', errors='strict'))))
            blocks = [{'type': 'table', 'rows': rows}]
        else:
            blocks = [{'type': 'paragraph', 'text': part} for part in data.decode('utf8', errors='strict').split('\n\n') if part.strip()]
        validate_blocks(blocks)
        if not text_for_blocks(blocks).strip():
            raise ConversionError('No text was extracted; no blank deliverable was generated.', 'NO_EXTRACTABLE_TEXT')
        result = directory / ('output.' + output)
        if output == 'txt': result.write_text(text_for_blocks(blocks), encoding='utf8')
        elif output == 'html': result.write_text(html_for_blocks(blocks), encoding='utf8')
        elif output == 'docx': docx_for_blocks(blocks, result)
        elif output == 'xlsx': xlsx_for_blocks(blocks, result)
        elif output == 'pdf': pdf_for_blocks(blocks, result); pdf_pages(result)
        elif output == 'doc':
            docx_for_blocks(blocks, directory / 'output.docx'); result = office_convert(directory / 'output.docx', 'doc', directory)
        else:
            raise ConversionError('Image output requires PDF input.')
        if used_ocr: warnings.append('OCR may contain recognition errors; review text and numbers before relying on them.')
        return response([result], output, warnings, used_ocr)


def response(files, fmt, warnings, used_ocr):
    if not files or len(files) > MAX_PAGES:
        raise ConversionError('No output or too many output files.', 'CONTENT_LIMIT')
    outputs = []; total = 0
    for index, path in enumerate(files):
        size = path.stat().st_size; total += size
        if not 0 < size <= MAX_BYTES or total > MAX_BYTES:
            raise ConversionError('Output exceeds the combined 25 MiB limit.', 'CONTENT_LIMIT')
        outputs.append({'filename': ('page-' + str(index + 1) if len(files) > 1 else 'output') + '.' + fmt,
                        'mime_type': MIMES[fmt], 'content_base64': base64.b64encode(path.read_bytes()).decode('ascii')})
    return {'ok': True, 'outputs': outputs, 'output_format': fmt, 'warnings': warnings, 'ocr_used': used_ocr}


if __name__ == '__main__':
    try:
        result = convert(json.load(sys.stdin))
        print(json.dumps(result, allow_nan=False))
    except ConversionError as error:
        print(json.dumps({'ok': False, 'code': error.code, 'error': str(error)})); sys.exit(1)
    except Exception:
        print(json.dumps({'ok': False, 'code': 'CONVERSION_FAILED', 'error': 'The input could not be converted safely.'})); sys.exit(1)
