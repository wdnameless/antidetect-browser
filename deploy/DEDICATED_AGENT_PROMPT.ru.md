# ПРОМПТ ДЛЯ АГЕНТА НА ДЕДИКЕ

Скопируй текст ниже агенту, который работает на твоём Windows-дейдике
(opencode / claude code и т.п.). Перед отправкой замени `ЧИСЛО_ПИРОВ`
на количество устройств/сервисов, которые будут подключаться (минимум 1).

---

## Задача: развернуть Antidetect Browser как серверный сервис

Разверни на этой машине антидетект-браузер из репозитория
https://github.com/wdnameless/antidetect-browser по инструкции
docs/SERVER_DEPLOY.ru.md (она в репо, прочитай её первой).

Архитектура: браузер и его данные живут ТОЛЬКО здесь, на сервере.
Владелец подключается с других устройств через WireGuard:
веб-панель http://10.8.0.1/ui (управление профилями + стрим браузера
с мышью/клавиатурой) и REST/CDP API для автоматизаций (Playwright и т.д.).

ВАЖНО про Docker: в контейнере живёт только Traefik (готовый конфиг лежит
в deploy/ репо). Сам сервис antidetect ставится НАТИВНО через NSSM,
потому что ядро — это Windows-бинарник chrome.exe, которому нужна
десктопная сессия. НЕ пытайся завернуть сервис в контейнер.

Выполняй шаги строго по порядку, после каждого — проверка. Если шаг упал,
чинись сам, не переходя дальше. В конце выведи отчёт (формат ниже).

### Шаг 0. Диагностика окружения
Проверь и зафиксируй: версия Windows, права администратора, есть ли уже
WireGuard / Node.js / Docker, свободное место на C:, публичный IP машины
(узнай через Invoke-RestMethod https://api.ipify.org). Если это машина за NAT
без проброшенных портов — сообщи, WireGuard всё равно заработает только при
наличии входящего UDP 51820 извне: проверь доступность порта и предупреди.

### Шаг 1. WireGuard (транспорт)
1. Установи WireGuard (winget install --id WireGuard.WireGuard или msi с официального сайта).
2. Сгенерируй ключи сервера: wg genkey / wg pubkey.
3. Создай C:\wg\server.conf: Address=10.8.0.1/24, ListenPort=51820,
   и по одному [Peer]-блоку на ЧИСЛО_ПИРОВ клиентов (10.8.0.2/32, 10.8.0.3/32, ...).
4. Активируй туннель БЕЗ GUI: & 'C:\Program Files\WireGuard\wireguard.exe' /installtunnelservice C:\wg\server.conf
5. Проверка: wg show должен показать интерфейс с Address 10.8.0.1; ping 10.8.0.1 проходит.
6. Открой входящий UDP 51820 в файрволе (New-NetFirewallRule).
7. Сгенерируй клиентские конфиги (Address=10.8.0.N/32, Endpoint=<публичный IP>:51820,
   AllowedIPs=10.8.0.0/24, PersistentKeepalive=25), сохрани каждый в
   C:\antidetect-clients\peer-N.conf. Это секреты — права на папку только у текущего админа.

### Шаг 2. Приложение
1. Установи Node LTS (winget install OpenJS.NodeJS.LTS).
2. git clone https://github.com/wdnameless/antidetect-browser.git C:\antidetect
3. В C:\antidetect: npm ci; npm run build:main; npm run ensure-kernel; npm run ensure-chromedriver
4. Проверка руками: задай env ANTIDETECT_SERVER_MODE=1, ANTIDETECT_TRUSTED_HOSTS=10.8.0.1,
   запусти node dist/src/main/index.js — должен напечатать «ready» и API key. Останови процесс.

### Шаг 3. Служба через NSSM
1. Скачай nssm.cc → nssm.exe в C:\antidetect\.
2. nssm install AntidetectService "C:\Program Files\nodejs\node.exe" "C:\antidetect\dist\src\main\index.js"
3. AppDirectory=C:\antidetect; AppEnvironmentExtra="ANTIDETECT_SERVER_MODE=1 ANTIDETECT_TRUSTED_HOSTS=10.8.0.1 API_HOST=127.0.0.1"; Start=SERVICE_AUTO_START.
4. Start-Service AntidetectService. Проверка: Invoke-WebRequest http://127.0.0.1:50325/status → {"code":0,...}.
   Сохрани значение C:\Users\<user>\.antidetect\data\api_key в отчёт (это ключ доступа!).

### Шаг 4. Десктоп-сессия для браузера (критично!)
Браузер работает headed и умрёт без активной сессии:
1. Настрой автологон: HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon →
   DefaultUserName, DefaultPassword (пароль учётки!), AutoAdminLogon=1.
2. MaxDisconnectionTime=0 (DWord) в HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services.
3. Перезагрузи машину один раз и убедись, что после загрузки сессия залогинена
   автоматически и служба AntidetectService работает (Get-Service).

### Шаг 5. Traefik в Docker
1. Убедись, что Docker работает (docker ps). Если нет — установи/запусти и сообщи, что сделал.
2. cd C:\antidetect\deploy; docker compose up -d
3. Проверка: Invoke-WebRequest http://10.8.0.1/ui -Headers @{Host='10.8.0.1'} → HTTP 200 HTML.
   Если Docker Desktop не даёт биндить 10.8.0.1 — поменяй маппинг в docker-compose.yml
   на "80:80", но убедись, что порт 80 закрыт извне файрволом (см. шаг 6).

### Шаг 6. Файрвол
Убедись, что наружу открыты только UDP 51820 и порты, нужные для твоего RDP-доступа.
НЕ блокируй RDP (3389) отовсюду, пока владелец не подтвердит альтернативный способ
подключения — просто проверь и перечисли в отчёте все открытые входящие правила.

### Шаг 7. Финальная верификация (выполни всё)
- Get-Service AntidetectService → Running
- wg show → интерфейс активен
- docker ps → traefik Up
- Invoke-WebRequest http://127.0.0.1:50325/status → 200
- Invoke-WebRequest http://10.8.0.1/ui -Headers @{Host='10.8.0.1'} → 200
- Invoke-WebRequest http://127.0.0.1:50999/status c заголовком Host: evil.com на ЛОКАЛЬНОМ
  тестовом порту не нужен; вместо этого проверь: запрос к :50325 с чужим Host → 403
  (Invoke-WebRequest -Headers @{Host='evil.com'} http://127.0.0.1:50325/status должен дать 403)

### Формат отчёта
1. Статус каждого шага (OK / сделано с отклонениями / FAIL + причина)
2. Публичный IP и порт WireGuard
3. Пути к клиентским конфигам C:\antidetect-clients\*.conf (сколько создано)
4. URL панели: http://10.8.0.1/ui и API-ключ (секрет — продублируй отдельной строкой)
5. Все открытые наружу порты
6. Что осталось сделать вручную владельцу (например: импортировать peer-N.conf
   на свои устройства в приложение WireGuard)

Не публикуй ничего в интернет, не меняй правила файрвола сверх перечисленного,
не отправляй api_key и приватные ключи никуда кроме локальных файлов.
