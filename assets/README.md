# Знаки расширения

`export.svg` и `icon-{16,32,48,128}.png` — знак MAX Архив со стрелкой экспорта. Геометрия симметрична относительно x=64: наконечник под 45°, одинаковая ширина линий 9 единиц, одинаковые окончания. SVG и PNG создаются из одного набора координат скриптом `scripts/build-icons.py` (Python + Pillow). Цвета фона сохраняют связь с MAX; официальный контур MAX не используется.

`jtd-light.svg` и `jtd-dark.svg` скопированы без изменений из утверждённого набора `D:\DEV\JTD\brand\jtd-marks\JTD_logo`:

| Файл | Оригинал | SHA-256 |
| --- | --- | --- |
| `jtd-light.svg` | `jtd-wire-dot-on-light.svg` | `b3c6c144e2ccecb74859687b252c98dfe5e71a5aeb970d51d3e145d4e985b00e` |
| `jtd-dark.svg` | `jtd-cube-dot-on-dark.svg` | `ddf6c9862be7ee7ed6e6da25a0d095755c4fa929a5084d72ee0d795b3b7d4fcf` |

Общий источник набора и правила применения: `https://justtrust.digital/brand/jtd-marks/JTD_logo/`. Контурный знак предназначен для светлой поверхности, залитый — для тёмной. Минимальная высота авторского знака 32 px, свободное поле не менее четверти его высоты; ссылка ведёт на `https://justtrust.digital`. По прямой правке владельца от 22.10.2026 текстовая подпись убрана; у видимого знака alt="JTD". Геометрия и цвет SVG сохранены.

Команда повторной генерации иконок на компьютере владельца:

```powershell
Set-Location D:\DEV\MaxExport
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts/build-icons.py
```
