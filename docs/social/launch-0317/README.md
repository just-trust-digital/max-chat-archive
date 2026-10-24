# Материалы к посту о тестировании 0.3.17

- [Текст поста](post.md)
- [Слайд 1: выбор чатов](01-export.png)
- [Слайд 2: результат экспорта](02-result.png)

Оба изображения — 1080 × 1080 px. На первом использован снимок интерфейса расширения с синтетическими чатами; на втором — HTML, собранный текущим `format.js` из [вымышленной переписки](sample-chat.json). Это иллюстрация функций, а не архив реального аккаунта MAX. Фоновая графика с пузырями сообщений создана отдельно; интерфейс и весь текст набраны в HTML/CSS.

Повторная сборка на Windows с установленным Playwright Chromium и Node.js (из корня репозитория):

```powershell
$env:NODE_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = "$HOME\AppData\Local\ms-playwright\chromium_headless_shell-1248\chrome-headless-shell-win64\chrome-headless-shell.exe"
node docs/social/launch-0317/render.cjs
```

Локальный просмотр источника: откройте `docs/social/launch-0317/carousel.html?slide=1` и `?slide=2` как файлы в браузере. Публиковать готовые PNG можно без локального сервера. Сборка не отправляет данные и не подключается к MAX.
