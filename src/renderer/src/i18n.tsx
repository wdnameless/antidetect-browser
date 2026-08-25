// Lightweight i18n (v0.2.21): English strings are the keys; the RU dictionary
// maps them to Russian. Missing translations fall back to the English key.
import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ru';

const RU: Record<string, string> = {
  // Navigation
  'Profiles': 'Профили',
  'Groups': 'Группы',
  'Proxies': 'Прокси',
  'Devices': 'Устройства',
  'Extensions': 'Расширения',
  'Settings': 'Настройки',
  'Loading Antidetect...': 'Загрузка Antidetect...',
  'Local Core: 127.0.0.1': 'Локальное ядро: 127.0.0.1',

  // Profiles header
  'Search profile name, ID, or proxy...': 'Поиск по имени, ID или прокси...',
  'All Groups': 'Все группы',
  'All Platforms': 'Все платформы',
  'All Statuses': 'Все статусы',
  'Windows': 'Windows',
  'macOS': 'macOS',
  'Android': 'Android',
  'iOS': 'iOS',
  'Linux': 'Linux',
  'Running': 'Работает',
  'Closed': 'Закрыт',
  'Batch Create': 'Массовое создание',
  'Import CSV': 'Импорт CSV',
  'Import Bundle': 'Импорт пакета',
  'New Profile': 'Новый профиль',

  // Profiles table
  'Profile Name': 'Имя профиля',
  'Proxy': 'Прокси',
  'Device / OS': 'Устройство / ОС',
  'Fingerprint': 'Отпечаток',
  'Status': 'Статус',
  'Actions': 'Действия',
  'Unnamed Profile': 'Без имени',
  'Ungrouped': 'Без группы',
  'Unknown': 'Неизвестно',
  'Direct (No Proxy)': 'Напрямую (без прокси)',
  'No profiles match your search criteria.': 'Нет профилей по вашему запросу.',
  'No profiles yet': 'Профилей пока нет',
  'Create your first browser profile — each profile gets a unique fingerprint, device, and proxy. Click': 'Создайте первый профиль — каждый получает уникальный отпечаток, устройство и прокси. Нажмите',
  'to get started.': 'чтобы начать.',

  // Row menu
  'Duplicate Profile': 'Дублировать профиль',
  'Export Profile (bundle)': 'Экспорт профиля (пакет)',
  'Randomize Seed': 'Случайный Seed',
  'Manage Cookies': 'Куки',
  'Fingerprint Config': 'Конфиг отпечатка',
  'Bind Extensions': 'Расширения',
  'Delete Profile': 'Удалить профиль',
  'More actions': 'Ещё действия',
  'Start Profile': 'Запустить профиль',
  'Stop Profile': 'Остановить профиль',
  'Edit Profile Settings (Proxy / Fingerprint)': 'Настройки профиля (прокси / отпечаток)',
  'Click to copy full Seed': 'Нажмите, чтобы скопировать Seed',
  '✓ Copied!': '✓ Скопировано!',

  // Bulk bar
  'Selected': 'Выбрано',
  'Start': 'Запустить',
  'Stop': 'Остановить',
  'Move to Group...': 'Перенести в группу...',
  '(No Group / Ungrouped)': '(Без группы)',
  'Apply': 'Применить',
  'Delete': 'Удалить',
  'Start selected profiles': 'Запустить выбранные профили',
  'Stop selected profiles': 'Остановить выбранные профили',
  'Delete selected profiles': 'Удалить выбранные профили',
  'Deselect all': 'Снять выделение',

  // Pagination
  'Total': 'Всего',
  'profile': 'профиль',
  'profiles': 'профилей',
  'Page': 'Стр.',
  'of': 'из',
  '← Prev': '← Назад',
  'Next →': 'Вперёд →',
  '50 / page': '50 / стр.',
  '100 / page': '100 / стр.',
  '200 / page': '200 / стр.',

  // Modal
  'Create New Profile': 'Новый профиль',
  'Edit Profile': 'Редактирование профиля',
  'General Overview': 'Общие',
  'Proxy Configuration': 'Прокси',
  'Fingerprint & Hardware': 'Отпечаток и железо',
  'Save Profile': 'Сохранить',
  'Cancel': 'Отмена',
  'Device Preset': 'Пресет устройства',
  'Default Preset (Windows 11 PC)': 'По умолчанию (Windows 11 ПК)',
  'Phone Model (fixed)': 'Модель телефона (фикс.)',
  'Auto (from seed)': 'Авто (из seed)',
  'Hardware Fingerprint': 'Аппаратный отпечаток',
  'Fingerprint Seed (manual)': 'Seed отпечатка (вручную)',
  'Fix the seed to keep the same device & fingerprint across restarts (recommended for long-lived accounts).': 'Зафиксируйте seed, чтобы устройство и отпечаток не менялись между запусками (рекомендуется для долгоживущих аккаунтов).',

  // Groups page
  'Profile Groups': 'Группы профилей',
  'Organize your browser profiles by projects, clients, or account categories.': 'Организуйте профили по проектам, клиентам или категориям аккаунтов.',
  'New Group': 'Новая группа',
  'Search groups...': 'Поиск групп...',
  'Group Name': 'Название группы',
  'Profiles Count': 'Профилей',
  'Group ID': 'ID группы',
  'No groups yet': 'Групп пока нет',
  'Create groups to keep dozens or hundreds of profiles neatly organized.': 'Создавайте группы, чтобы держать десятки и сотни профилей в порядке.',
  'Create First Group': 'Создать первую группу',
  'No groups matching search': 'Групп по запросу не найдено',
  'View profiles in this group': 'Показать профили группы',
  'Rename group': 'Переименовать группу',
  'Delete group': 'Удалить группу',
  'Create New Group': 'Новая группа',
  'Rename Group': 'Переименовать группу',
  'Group Name *': 'Название группы *',
  'Creating...': 'Создание...',
  'Create Group': 'Создать группу',
  'Saving...': 'Сохранение...',
  'Save Changes': 'Сохранить',

  // Proxies page
  'Proxy Manager': 'Прокси-менеджер',
  'proxies configured': 'прокси настроено',
  'Add Proxy': 'Добавить прокси',
  'Type': 'Тип',
  'Host : Port': 'Хост : Порт',
  'Username': 'Логин',
  'Location / IP': 'Локация / IP',
  'Not tested': 'Не проверен',
  'Test Connection': 'Проверить соединение',
  'Delete Proxy': 'Удалить прокси',
  'No proxies configured yet': 'Прокси ещё не настроены',
  'Proxies give each profile its own IP address — essential for running many accounts safely.': 'Прокси даёт каждому профилю свой IP-адрес — основа безопасной работы с множеством аккаунтов.',
  'HTTP / HTTPS': 'HTTP / HTTPS',
  'Best for most tasks (browsing, social networks). Easy to set up, widely supported.': 'Лучший выбор для большинства задач (браузинг, соцсети). Просто настроить, широкая поддержка.',
  'SOCKS5': 'SOCKS5',
  'Handles all traffic types (TCP/UDP). Recommended for banking, crypto and heavy anti-detection.': 'Пропускает весь трафик (TCP/UDP). Рекомендуется для банкинга, крипты и серьёзной антидетекции.',
  'SSH Tunnel': 'SSH-туннель',
  'Routes traffic through a Linux server you own — free and stable if you have one.': 'Трафик через ваш Linux-сервер — бесплатно и стабильно, если сервер есть.',

  // Devices page
  'Device & Hardware Presets': 'Пресеты устройств',
  'Built-in device profiles and mobile phone pools for realistic hardware fingerprint spoofing.': 'Встроенные пресеты устройств и пул смартфонов для реалистичной подмены отпечатка.',
  'Platform Presets': 'Пресеты платформ',
  'Touch Enabled': 'Сенсорный ввод',
  'Mouse & Keyboard': 'Мышь и клавиатура',
  'Desktop Resolution': 'Десктопное разрешение',
  'Phone Pool': 'Пул телефонов',

  // Extensions page
  'No extensions imported yet': 'Расширения ещё не импортированы',
  'Import an unpacked extension folder (e.g. MetaMask, EditThisCookie) to load it into your profiles. Click': 'Импортируйте распакованную папку расширения (например MetaMask) — оно будет загружаться в привязанные профили. Нажмите',
  'Bind to Profile': 'Привязать к профилю',

  // Settings page
  'Settings & Automation': 'Настройки и автоматизация',
  'General': 'Общие',
  'Automation API': 'API автоматизации',
  'Data Folder': 'Папка данных',
  'Updates': 'Обновления',
  'Diagnostics': 'Диагностика',
  'Automation API (for your scripts)': 'API автоматизации (для ваших скриптов)',
  'Endpoint URL': 'Адрес API',
  'Bearer API Key': 'API-ключ (Bearer)',
  'Hide': 'Скрыть',
  'Show': 'Показать',
  'Copy': 'Копировать',
  'Use this key to connect your own bots and scripts (Puppeteer, Playwright, Selenium, Python) to the local API. Pass it in the HTTP header:': 'Ключ для подключения ваших ботов и скриптов (Puppeteer, Playwright, Selenium, Python) к локальному API. Передавайте в заголовке:',
  'Data Folder (Profiles, Cache, Kernel)': 'Папка данных (профили, кэш, ядро)',
  'Current folder': 'Текущая папка',
  'Change Folder…': 'Сменить папку…',
  'Open in Explorer': 'Открыть в проводнике',
  'All browser profiles, cookies, extensions, the Chromium kernel and the database are stored here. Changing the folder takes effect after restarting the app.': 'Здесь хранятся профили, куки, расширения, ядро Chromium и база данных. Смена папки вступает в силу после перезапуска приложения.',
  'Software Updates': 'Обновления приложения',
  'Release Channel (GitHub Releases)': 'Канал обновлений (GitHub Releases)',
  'Check for updates': 'Проверить обновления',
  'Checking for updates…': 'Проверка обновлений…',
  'You are on the latest version.': 'У вас последняя версия.',
  'New version available': 'Доступна новая версия',
  'New build': 'Новая сборка',
  'Download Update': 'Скачать обновление',
  'Downloading…': 'Скачивание…',
  'Update ready': 'Обновление готово',
  'Ready to install': 'Готово к установке',
  'Restart & install': 'Перезапустить и установить',
  'Update check failed': 'Ошибка проверки обновлений',
  'Updates are available in the installed app.': 'Обновления доступны в установленном приложении.',
  'Browser Kernel (fingerprint-chromium)': 'Ядро браузера (fingerprint-chromium)',
  'Installed version': 'Установленная версия',
  'Upstream check': 'Проверка апстрима',
  'Check for kernel update': 'Проверить обновление ядра',
  'Checking…': 'Проверка…',
  'Update available': 'Доступно обновление',
  'You are on the latest kernel': 'У вас актуальное ядро',
  'Open releases': 'Открыть релизы',
  'The kernel is intentionally pinned (stealth patches are version-specific). Updating is manual: download the new Windows build, replace the folder under': 'Ядро намеренно зафиксировано (stealth-патчи привязаны к версии). Обновление вручную: скачайте новый Windows-билд и замените папку в',
  'Diagnostics & Logs': 'Диагностика и логи',
  'Log folder': 'Папка логов',
  'Open Logs Folder': 'Открыть папку логов',
  'Recent log files (kept 14 days):': 'Свежие логи (хранятся 14 дней):',
  'Logs include service lifecycle, profile start/stop errors, backups and crash recovery events. Send the newest': 'Логи содержат жизненный цикл сервиса, ошибки запуска/остановки профилей, бэкапы и crash recovery. Приложите свежий',
  'when reporting an issue.': 'при обращении в поддержку.',
  'Interface language. Applies immediately.': 'Язык интерфейса. Применяется сразу.',
  'Language': 'Язык интерфейса',
  'English': 'English',
  'Russian': 'Русский',
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
}

const Ctx = createContext<I18nCtx>({ lang: 'en', setLang: () => undefined, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem('lang');
    return stored === 'ru' ? 'ru' : 'en';
  });
  const setLang = (l: Lang): void => {
    setLangState(l);
    localStorage.setItem('lang', l);
  };
  const t = (s: string): string => (lang === 'ru' ? RU[s] ?? s : s);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}
