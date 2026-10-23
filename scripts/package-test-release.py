"""Build a clean tester bundle and a one-page Russian PDF guide (ReportLab)."""
import hashlib
import json
from pathlib import Path
import zipfile

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
OUT = ROOT / 'output'
PDF = OUT / 'pdf' / 'max-archive-quick-start.pdf'
FILES = [
    'assets/fonts/Inter-Variable.ttf', 'assets/fonts/OFL-Inter.txt',
    'assets/LICENSE-octicons.txt',
    'updates.js', 'updates.css',
    'skills/max-archive/SKILL.md', 'skills/max-archive/references/archive.md',
    'manifest.json', 'popup.html', 'popup.js', 'export.html', 'export.js',
    'report.html', 'report.js', 'reporting.js', 'known-issues.html', 'known-issues.js', 'known-issues.json',
    'styles.css', 'content.js', 'format.js', 'checkpoint.js', 'zip.js',
    'download-bridge.js', 'timer-worker.js', 'directory.js', 'calendar.js', 'LICENSE',
    'assets/export.svg', 'assets/jtd-light.svg', 'assets/jtd-dark.svg',
    'assets/icon-16.png', 'assets/icon-32.png', 'assets/icon-48.png', 'assets/icon-128.png',
]


def build_pdf():
    PDF.parent.mkdir(parents=True, exist_ok=True)
    fonts = Path('C:/Windows/Fonts')
    pdfmetrics.registerFont(TTFont('Guide', str(fonts / 'arial.ttf')))
    pdfmetrics.registerFont(TTFont('GuideBold', str(fonts / 'arialbd.ttf')))
    pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='GuideBold')
    styles = {
        'title': ParagraphStyle('title', fontName='GuideBold', fontSize=24, leading=29, textColor=colors.HexColor('#17243a'), spaceAfter=6),
        'sub': ParagraphStyle('sub', fontName='Guide', fontSize=10, leading=14, textColor=colors.HexColor('#526178'), spaceAfter=18),
        'heading': ParagraphStyle('heading', fontName='GuideBold', fontSize=14, leading=18, textColor=colors.HexColor('#145bd6'), spaceBefore=12, spaceAfter=9),
        'body': ParagraphStyle('body', fontName='Guide', fontSize=11, leading=16, alignment=TA_LEFT, spaceAfter=7),
        'note': ParagraphStyle('note', fontName='Guide', fontSize=10, leading=14, textColor=colors.HexColor('#45556c'), spaceAfter=7),
    }
    story = []
    def p(text, style='body'):
        story.append(Paragraph(text, styles[style]))
    p('MAX Архив', 'title')
    p(f'Краткая инструкция • Тестовая версия {VERSION} • Chrome для компьютера', 'sub')
    p('1. Установите расширение', 'heading')
    p('1. Распакуйте полученный ZIP: правой кнопкой по файлу → <b>Извлечь все</b>. Папку сохраните: не удаляйте её после установки.')
    p('2. Вставьте <b>chrome://extensions</b> в адресную строку Chrome и нажмите Enter.')
    p('3. Включите <b>Режим разработчика</b> в правом верхнем углу.')
    p('4. Нажмите <b>Загрузить распакованное расширение</b>. Выберите папку <b>MaxExport</b> внутри распакованного архива. В ней лежит manifest.json.')
    p('5. Откройте <b>web.max.ru</b> и войдите в MAX. Если вкладка уже была открыта, обновите её. Через значок пазла в Chrome найдите <b>MAX Архив</b>.')
    p('2. Сохраните переписку', 'heading')
    p('1. Откройте нужный чат в MAX. Нажмите пазл → <b>MAX Архив</b> → <b>Экспортировать открытый чат</b>. Экспорт начнётся сразу.')
    p('2. Для выбора нескольких чатов, периода и вложений нажмите <b>Настройки и выбор чатов</b>. Выберите <b>Способ сохранения</b>: ZIP или папка в Загрузках. Лимиты по умолчанию — 25 МБ на файл и 250 МБ на архив/папку; их можно изменить. Нажмите <b>Скачать ZIP</b> либо <b>Сохранить в папку</b>.')
    p('<b>Во время экспорта держите вкладку MAX открытой и видимой.</b> Не переключайте чаты и не обновляйте страницу. Если появилось «Откройте вкладку MAX», перейдите на MAX вручную: работа продолжится автоматически.')
    p('3. Для ZIP распакуйте скачанный файл. Для режима папки откройте новый каталог <b>max-archive-…</b> в Загрузках. Запустите <b>index.html</b> в корне и выберите чат. Сохраняйте структуру папок: в них лежат вложения.')
    p('Если что-то пошло не так', 'heading')
    p('Остановить экспорт можно кнопкой <b>Остановить</b> на странице расширения. После сбоя откройте вкладку <b>История экспорта</b> → <b>Скачать сохранённое</b>. Это сохранённая часть, а не продолжение экспорта.', 'note')
    p('Внизу меню расширения нажмите ссылку <b>Нашли баг или есть предложения по улучшению? Напишите нам.</b> Перед отправкой проверьте текст и подтвердите согласие. Не прикладывайте переписку, файлы и report.json: в нём могут быть названия чатов и адреса вложений.', 'note')
    p('Доступны только данные, которые показывает веб-версия MAX. Некоторые вложения могут быть пропущены. «Чтение истории» у сохранённой копии означает последний записанный этап, а не успешное завершение.', 'note')

    def footer(canvas, doc):
        canvas.setStrokeColor(colors.HexColor('#dce3ed'))
        canvas.line(40, 34, A4[0]-40, 34)
        canvas.setFont('Guide', 8)
        canvas.setFillColor(colors.HexColor('#526178'))
        canvas.drawString(40, 22, f'MAX Архив {VERSION} | 23.10.2026')
        canvas.drawRightString(A4[0]-40, 22, '1 / 1')

    SimpleDocTemplate(str(PDF), pagesize=A4, rightMargin=40, leftMargin=40,
                      topMargin=32, bottomMargin=44, title='MAX Архив: установка и экспорт',
                      author='MAX Архив').build(story, onFirstPage=footer, onLaterPages=footer)
    reader = PdfReader(PDF)
    assert len(reader.pages) == 1, 'Guide must fit on one page'
    text = reader.pages[0].extract_text()
    assert all(s in text for s in ['chrome://extensions', 'manifest.json', 'index.html', 'report.json'])


def build_zip():
    target = OUT / f'max-archive-{VERSION}-test.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(PDF, 'START-HERE.pdf')
        for name in FILES:
            archive.write(ROOT / name, f'MaxExport/{name}')
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(FILES) + 1
        for name in FILES:
            assert archive.read(f'MaxExport/{name}') == (ROOT / name).read_bytes()
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(f'{digest}  {target.name}\n', encoding='ascii')
    print(f'PDF: {PDF}\nZIP: {target}\nFiles: {len(FILES)} + guide\nSHA256: {digest}')


if __name__ == '__main__':
    build_pdf()
    build_zip()
