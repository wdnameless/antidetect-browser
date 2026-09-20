# Architecture Specification: Android Emulator Integration (Cross-Platform)

## 1. Executive Summary & Core Decisions

Данная спецификация описывает интеграцию полноценного мобильного Android-окружения в антидетект-браузер.
В соответствии с согласованным вектором приняты следующие архитектурные решения:

1. **Движок виртуализации:** Headless Google AOSP QEMU Android Emulator (`emulator -no-window -no-audio`).
2. **Кроссплатформенность:**
   - **Windows:** Нативная виртуализация через WHPX (Windows Hypervisor Platform) или AEHD. Архитектура образов: `x86_64` с встроенной трансляцией ARM.
   - **macOS:** Нативная виртуализация через Hypervisor.framework (HVF). На Apple Silicon (M1–M4) запуск нативных `arm64-v8a` образов без трансляции (максимальная производительность).
   - **Linux:** Нативная виртуализация через KVM (`x86_64`).
3. **Модель доставки бинарников (Packaging):** On-Demand Downloader. Базовый дистрибутив антидетекта остается легковесным; движок эмулятора (~150 МБ) и базовый образ Android (~800 МБ) загружаются и распаковываются только при создании первого Android-профиля.
4. **Интеграция экрана (Display & Control):** Встроенный HTML5 `<canvas>` с аппаратным декодированием видеопотока H.264 через браузерный стандарт **WebCodecs** на базе протокола **Scrcpy** (`@yume-chan/scrcpy`). Никаких нативных окон ОС (`SetParent`, `NSView`), что гарантирует идентичное поведение UI на Windows, macOS и Linux.
5. **Глубина спуфинга:** Глубокая аппаратная и системная подмена:
   - Переопределение `build.prop` и аппаратных идентификаторов (IMEI, Android ID, MAC, Serial).
   - Zygisk/Magisk слой для сокрытия признаков эмулятора (qemu/goldfish артефакты) и прохождения проверок Play Integrity / SafetyNet.
   - Сетевая изоляция через локальный `tun2socks` (весь трафик, включая DNS и UDP, заворачивается в прокси профиля без утечек).
   - Динамическая подмена геопозиции и сенсоров (акселерометр/гироскоп с микрошумом) через gRPC Controller API.

---

## 2. Архитектурная диаграмма системы

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Tauri / React Desktop UI                           │
│  ┌───────────────────────────┐    ┌──────────────────────────────────┐  │
│  │ Desktop Profile (WebView) │    │ Android Profile Tab              │  │
│  │ Chromium / Firefox        │    │  ├─ <canvas> (WebCodecs H.264)   │  │
│  │                           │    │  ├─ Touch/Swipe Mouse Controller │  │
│  │                           │    │  └─ Toolbar (Back, Home, Power)  │  │
│  └───────────────────────────┘    └─────────────────▲────────────────┘  │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │ WebSocket / IPC
┌─────────────────────────────────────────────────────┼───────────────────┐
│                   Main Process (Node.js Backend)    │                   │
│  ┌────────────────────────┐   ┌─────────────────────┴────────────────┐  │
│  │ ProfileManager         │   │ AndroidProfileManager                │  │
│  │  - Desktop profiles    │   │  ├─ Lifecycle (Spawn/Kill/Pause)     │  │
│  │  - Cookie / Storage    │   │  ├─ Scrcpy Stream Host (ADB Socket)  │  │
│  └────────────────────────┘   │  ├─ gRPC Controller (Sensors/Geo)    │  │
│                               │  ├─ PackageDownloader (On-demand)    │  │
│                               │  └─ Snapshot & Overlay Diff Disks    │  │
│                               └─────────────────────┬────────────────┘  │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │ Process Exec / ADB
┌─────────────────────────────────────────────────────▼───────────────────┐
│                 Headless AOSP Android Emulator System                   │
│                                                                         │
│   Windows (WHPX)        macOS (HVF, ARM64)          Linux (KVM)         │
│   x86_64 Image          arm64-v8a Image            x86_64 Image         │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ Android Guest OS                                                │   │
│   │  ├─ System Overlay (Read-Only Base + Profile Diff Userdata)     │   │
│   │  ├─ scrcpy-server.jar (Captures display & injects input)        │   │
│   │  ├─ Zygisk / LSPosed (Anti-Detection & Hardware Spoofing)       │   │
│   │  └─ tun2socks VPN Client (Directs all traffic to profile proxy) │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Детальные подсистемы

### 3.1. Управление образами и профилями (Disk & State Isolation)

Для изоляции профилей используется стратегия **Copy-on-Write / Differencing Disks**:
* **Base Image (Read-Only):**
  Хранится в `data/android/base/` (`system.img`, `vendor.img`, `ramdisk.img`). Этот образ никогда не модифицируется напрямую.
* **Profile Overlay:**
  При создании профиля в `data/profiles/<profile_id>/android/` создается пустой или клонированный оверлей `userdata.qcow2` (или разреженный `userdata.img`).
* **Команда запуска инстанса:**
  ```bash
  emulator -avd base_avd \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -read-only-system \
    -data "data/profiles/<profile_id>/android/userdata.img" \
    -gpu host \
    -grpc 8554 \
    -port 5554
  ```
* **Snapshots (Мгновенный запуск):**
  После первого запуска и настройки профиля создается qemu snapshot (`quickboot`). Последующие старты профиля занимают 2–3 секунды вместо холодного старта Android (20–40 с).

### 3.2. Подсистема отображения и ввода (Canvas WebCodecs Stream)

Интеграция экрана реализована на чистом Web-стеке без платформенно-зависимых окон ОС:
1. **Scrcpy Server:** Бекенд запускает `scrcpy-server.jar` внутри Android через ADB-команду:
   ```bash
   adb push scrcpy-server.jar /data/local/tmp/scrcpy-server.jar
   adb forward tcp:1024 localabstract:scrcpy
   adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 2.4 ...
   ```
2. **Трансляция по WebSocket:** Бекенд перенаправляет бинарный поток видео H.264 во фронтенд через локальный WebSocket.
3. **Рендеринг на React Frontend:**
   * Компонент `AndroidScreenCanvas.tsx` использует `@yume-chan/scrcpy` и браузерный `VideoDecoder` (WebCodecs).
   * Видеокадры отрисовываются на `HTMLCanvasElement` с нулевым копированием памяти (Zero-copy GPU render).
   * Задержка ввода-вывода составляет 25–40 мс при 60 FPS.
4. **Обработка ввода (Touch & Keyboard):**
   * События мыши (`mousedown`, `mousemove`, `mouseup`) маппятся в сенсорные координаты экрана Android и отправляются управляющими пакетами в Scrcpy Control Channel.
   * Поддерживаются жесты (pinch-to-zoom, свайпы колесом мыши).
   * В UI добавляется плавающая панель с аппаратными кнопками: "Назад", "Домой", "Недавние приложения", "Питание", "Поворот экрана".

### 3.3. Антидетект-слой и спуфинг железа (Mobile Fingerprint)

В Android-профиль закладывается расширенный фингерпринт реального устройства:
1. **Device Identity (Свойства сборки):**
   * `ro.product.manufacturer`, `ro.product.brand`, `ro.product.model`, `ro.product.name`, `ro.product.device`.
   * `ro.build.fingerprint`, `ro.build.id`, `ro.build.version.release`, `ro.build.version.sdk`.
   * Подмена осуществляется на раннем этапе загрузки через кастомный `default.prop` или Magisk `resetprop`.
2. **Hardware Identifiers:**
   * IMEI / MEID (через QEMU GSM эмуляцию и перехват TelephonyManager).
   * Android ID (через `settings put secure android_id <unique_id>`).
   * MAC-адреса Wi-Fi и Bluetooth.
   * Серийный номер (`ro.serialno`).
3. **Anti-Detection (Обход детекта эмулятора):**
   * Скрытие QEMU/Goldfish драйверов и файлов из файловой системы (`/dev/qemu_pipe`, `/dev/goldfish_*`, `/sys/class/android_usb/`).
   * Маскировка процессора в `/proc/cpuinfo` под реальный ARM SoC (Qualcomm Snapdragon / Google Tensor) для x86_64 инстансов.
   * Zygisk-модуль скрывает Root и Magisk от банковских приложений и антифрод-систем.
4. **Geo & Sensors:**
   * Проброс GPS координат по протоколу gRPC:
     ```protobuf
     service EmulatorController {
       rpc setCustomGpsCoordinates(GpsCoordinates) returns (Empty);
       rpc setPhysicalModel(PhysicalModelValue) returns (Empty);
     }
     ```
   * Координаты автоматически синхронизируются с геопозицией назначенного прокси.
   * Сенсоры (акселерометр, гироскоп) генерируют реалистичный естественный микрошум, предотвращая обнаружение статической «виртуальной» машины.

### 3.4. Сетевая изоляция и Проксирование (tun2socks)

Для предотвращения любых сетевых утечек трафика (WebRTC, системный DNS, пуши):
1. В образ Android встраивается легковесный клиент `tun2socks`.
2. При старте инстанса создается виртуальный интерфейс `tun0`, куда маршрутизируется 100% исходящего трафика Android.
3. `tun2socks` направляет TCP и UDP пакеты напрямую в SOCKS5/HTTP прокси, настроенный для данного профиля в антидетект-браузере.
4. Это гарантирует отсутствие прямого соединения в обход прокси (no direct leak).

### 3.5. On-Demand Package Downloader

Чтобы дистрибутив антидетекта не весил 1+ ГБ:
1. В настройках антидетекта добавляется раздел «Android Engine».
2. Менеджер загрузок проверяет контрольные суммы и скачивает необходимые компоненты в фоновом режиме:
   * **Core Tools (~60 МБ):** `adb`, `emulator`, зависимости hypervisor.
   * **Base System Image (~700 МБ):** Android 13/14 AOSP Image с предустановленными скриптами спуфинга.
3. Прогресс отображается в интерфейсе с возможностью паузы и докачки.

---

## 4. План реализации по этапам (Roadmap)

### Этап 1: Ядро и On-Demand Downloader (Foundation)
- Создание менеджера пакетов `AndroidPackageManager.ts`: проверка наличия бинарников эмулятора, скачивание и распаковка base-образа.
- Детектор гипервизора Windows (проверка включенности WHPX).
- Реализация базового `AndroidLauncher.ts` для запуска `emulator.exe -no-window`.

### Этап 2: Трансляция дисплея и управление (Scrcpy + WebCodecs)
- Интеграция `scrcpy-server.jar` через ADB.
- Реализация WebSocket стримера в Main-процессе.
- Создание React-компонента `AndroidCanvas.tsx` с декодером `@yume-chan/scrcpy` и трансляцией кликов мыши в тачи.

### Этап 3: Профилирование и Спуфинг (Antidetect Layer)
- Расширение схемы БД `profiles` поддержкой `type: 'desktop' | 'android'`.
- Генератор мобильных фингерпринтов (`mobileFingerprintGenerator.ts`).
- Скрипты инъекции `build.prop`, Android ID, IMEI.
- Интеграция gRPC контроллера для передачи GPS координат прокси.

### Этап 4: Сеть, Проксирование и Снапшоты
- Настройка `tun2socks` сервиса внутри базового образа.
- Интеграция быстрого восстановления через QEMU Snapshots.
- Тестирование на утечки WebRTC/DNS.

### Этап 5: Кроссплатформенная адаптация (macOS / Linux)
- Добавление резолвера гипервизоров HVF (Apple Silicon / Intel) и KVM.
- Добавление ARM64 системного образа для Mac M1–M4.
