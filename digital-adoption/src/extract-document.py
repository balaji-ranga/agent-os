"""Bounded extraction. No network requests, macros, active HTML, or shell commands."""
import sys, json, pathlib, re, tempfile, subprocess, zipfile, os, time
from html.parser import HTMLParser
from xml.etree import ElementTree

MAX_TEXT = 200_000
sections = []
def section(text, locator):
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text).strip()
    if text:
        if sum(len(s['text'].encode('utf-8')) for s in sections) + len(text.encode('utf-8')) > MAX_TEXT:
            raise ValueError('Extracted content limit exceeded')
        sections.append({'text': text, 'locator': locator})

def command(args, timeout=25):
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout).stdout.decode('utf-8', errors='strict')

def ocr(image):
    return command(['tesseract', str(image), 'stdout', '-l', 'eng', '--psm', '6'])

class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.hidden = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'template', 'iframe', 'object'): self.hidden += 1
        if tag in ('p', 'br', 'h1', 'h2', 'h3', 'li', 'tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'template', 'iframe', 'object'): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def extract(file, kind):
    raw = file.read_bytes()
    if len(raw) > 16 * 1024 * 1024: raise ValueError('File limit exceeded')
    if b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE' in raw: raise ValueError('Rejected scanning test signature')
    if kind in ('text', 'html'):
        text = raw.decode('utf-8-sig', errors='strict')
        if '\x00' in text: raise ValueError('Binary content in text upload')
        if kind == 'html':
            parser = TextHTML(); parser.feed(text); text = ''.join(parser.parts)
        section(text, 'Document')
    elif kind == 'docx':
        with zipfile.ZipFile(file) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(e.file_size for e in entries) > 32 * 1024 * 1024: raise ValueError('Archive limit exceeded')
            for e in entries:
                if e.filename.startswith(('/', '\\')) or '..' in pathlib.PurePosixPath(e.filename).parts or e.flag_bits & 1 or e.file_size > max(e.compress_size, 1) * 200: raise ValueError('Unsafe archive')
                if any(x in e.filename.lower() for x in ('vbaproject', '/embeddings/', 'activex')): raise ValueError('Active document content')
            xml = archive.read('word/document.xml')
            if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml: raise ValueError('Unsafe XML')
            tree = ElementTree.fromstring(xml)
            paragraphs = [''.join(p.itertext()) for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')]
            section('\n'.join(paragraphs), 'Document paragraphs')
    elif kind == 'pdf':
        from pypdf import PdfReader
        if not raw.startswith(b'%PDF-') or any(t in raw for t in (b'/JavaScript', b'/Launch', b'/EmbeddedFile', b'/RichMedia')): raise ValueError('Unsafe PDF')
        reader = PdfReader(file, strict=True)
        if reader.is_encrypted or not 0 < len(reader.pages) <= 30: raise ValueError('PDF limit or encryption')
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if not text.strip():
                with tempfile.TemporaryDirectory(prefix='adoption-ocr-') as temp:
                    output = pathlib.Path(temp) / 'page'
                    command(['pdftoppm', '-f', str(number), '-l', str(number), '-scale-to', '2000', '-singlefile', '-png', str(file), str(output)])
                    text = ocr(str(output) + '.png')
            section(text, f'Page {number}')
    elif kind == 'image':
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 16_000_000
        with Image.open(file) as image:
            if image.width * image.height > 16_000_000 or getattr(image, 'n_frames', 1) != 1: raise ValueError('Image limit exceeded')
            with tempfile.TemporaryDirectory(prefix='adoption-image-') as temp:
                cleaned = pathlib.Path(temp) / 'image.png'
                image.convert('RGB').save(cleaned)
                section(ocr(cleaned), 'Image OCR')
    elif kind == 'video':
        if raw[4:8] == b'ftyp': demuxer = 'mov'
        elif raw[:4] == b'\x1a\x45\xdf\xa3': demuxer = 'matroska'
        else: raise ValueError('Unsupported video signature')
        # Never auto-detect a playlist or follow network/external protocols.
        info = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-show_format', '-show_streams', '-of', 'json', str(file)]))
        duration = float(info['format']['duration'])
        video = next(s for s in info['streams'] if s.get('codec_type') == 'video')
        if not 0 < duration <= 120 or video['width'] * video['height'] > 8_300_000: raise ValueError('Video limit exceeded')
        with tempfile.TemporaryDirectory(prefix='adoption-video-') as temp:
            for second in range(0, max(1, int(duration)), 5):
                image = pathlib.Path(temp) / 'frame.png'
                command(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-ss', str(second), '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', str(file), '-frames:v', '1', '-vf', 'scale=1600:-1', '-threads', '1', str(image)])
                section(ocr(image), f'{second // 60:02d}:{second % 60:02d}')
            if any(s.get('codec_type') == 'audio' for s in info['streams']):
                audio = pathlib.Path(temp) / 'audio.wav'
                command(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-f', demuxer, '-i', str(file), '-map', '0:a:0', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-threads', '1', str(audio)])
                from faster_whisper import WhisperModel
                model = WhisperModel(os.environ['ADOPTION_ASR_MODEL'], device='cpu', compute_type='int8', cpu_threads=1, num_workers=1, local_files_only=True)
                segments, _ = model.transcribe(str(audio), language='en', beam_size=1, temperature=0, condition_on_previous_text=False, vad_filter=False)
                for segment in segments:
                    if segment.no_speech_prob < 0.6 and segment.avg_logprob >= -1:
                        start, end = int(segment.start), int(segment.end)
                        section(segment.text, f'{start // 60:02d}:{start % 60:02d}–{end // 60:02d}:{end % 60:02d} · speech')
    else: raise ValueError('Unsupported file type')
    if not sections: raise ValueError('No readable content found')
    return {'sections': sections}

if __name__ == '__main__':
    try:
        started = time.monotonic()
        result = extract(pathlib.Path(sys.argv[1]), sys.argv[2])
        result['metrics'] = {'elapsedSeconds': round(time.monotonic() - started, 3)}
        try:
            import resource
            result['metrics']['peakRssKiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        except ImportError:
            pass
        print(json.dumps(result))
    except Exception:
        # Do not expose document contents, host paths, or parser diagnostics.
        print('Document extraction failed or content is unsupported', file=sys.stderr)
        sys.exit(1)
